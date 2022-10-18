import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import { Construct } from 'constructs';

export class EcsCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);


    const githubUserName = new cdk.CfnParameter(this, "githubUserName", {
      type: "String",
      description: "Github username for source code repository",
      default: ""
    })

    const githubRepository = new cdk.CfnParameter(this, "githubRespository", {
      type: "String",
      description: "Github source code repository",
      default: "" 
    })

    const githubPersonalTokenSecretName = new cdk.CfnParameter(this, "githubPersonalTokenSecretName", {
        type: "String",
        description: "The name of the AWS Secrets Manager Secret which holds the GitHub Personal Access Token for this project.",
        default: "" 
    })


    const ecrRepo = new ecr.Repository(this, 'ecrRepo');

    /**
     * create a new vpc with single nat gateway
     */
    const vpc = new ec2.Vpc(this, 'ecs-cdk-vpc', {
      cidr: '10.0.0.0/16',
      natGateways: 1,
      maxAzs: 3  /* does a sample need 3 az's? */
    });

    const clusteradmin = new iam.Role(this, 'adminrole', {
      assumedBy: new iam.AccountRootPrincipal()
    });

    const cluster = new ecs.Cluster(this, "ecs-cluster", {
      vpc: vpc,
    });

    const logging = new ecs.AwsLogDriver({
      streamPrefix: "ecs-logs"
    });

    const taskrole = new iam.Role(this, `ecs-taskrole-${this.stackName}`, {
      roleName: `ecs-taskrole-${this.stackName}`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com')
    });



    // ***ecs contructs***

    const executionRolePolicy =  new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: ['*'],
      actions: [
                "ecr:getauthorizationtoken",
                "ecr:batchchecklayeravailability",
                "ecr:getdownloadurlforlayer",
                "ecr:batchgetimage",
                "logs:createlogstream",
                "logs:putlogevents"
            ]
    });

    const taskDef = new ecs.FargateTaskDefinition(this, "ecs-taskdef", {
      taskRole: taskrole
    });

    taskDef.addToExecutionRolePolicy(executionRolePolicy);

    /**
     * The base image thats used to construct a container based on the dockerfile in the node-app directory
     */
    const baseImage = 'public.ecr.aws/lts/ubuntu:latest'
    const container = taskDef.addContainer('node-app', {
      image: ecs.ContainerImage.fromRegistry(baseImage),
      memoryLimitMiB: 256,
      cpu: 256,
      logging
    });

    container.addPortMappings({
      containerPort: 5000,
      protocol: ecs.Protocol.TCP
    });

    /**
     * ACTUAL MAGIC 
     */
    const fargateService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, "ecs-service", {
      cluster: cluster,
      taskDefinition: taskDef,
      publicLoadBalancer: true,
      desiredCount: 1,
      listenerPort: 80
    });


    /**
     * FARGATE SCALING 
     */
    const scaling = fargateService.service.autoScaleTaskCount({ maxCapacity: 6 });
    scaling.scaleOnCpuUtilization('cpuscaling', {
      targetUtilizationPercent: 90,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60)
    });

    /**
     * GITHUB WEBHOOK
     * 
     */
    const gitHubSource = codebuild.Source.gitHub({
      owner: githubUserName.valueAsString,
      repo: githubRepository.valueAsString,
      webhook: true, // optional, default: true if `webhookfilteres` were provided, false otherwise
      webhookFilters: [
        codebuild.FilterGroup.inEventOf(codebuild.EventAction.PUSH).andBranchIs('main'),
      ], 
    });
   
    /**
     * CODEBUILD PROJECT
     */
    const project = new codebuild.Project(this, 'myProject', {
      projectName: `${this.stackName}`,
      source: gitHubSource,
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_6_0,
        privileged: true
      },
      environmentVariables: {
        'CLUSTER_NAME': {
          type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
          value: `${cluster.clusterName}`
        },
        'TAG': {
          type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
          value: `latest`
        },
        'ECR_REPO_URI': {
          type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
          value: `${ecrRepo.repositoryUri}`
        },
        'AWS_DEFAULT_REGION': {
          type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
          value: this.region,
        },
        'AWS_ACCOUNT_ID': {
          type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
          value: this.account,
        },
      },
      badge: true,

      /**
       * BUILDSPEC FILE
       */
      buildSpec: codebuild.BuildSpec.fromObject({
        version: "0.2",
        phases: {
          pre_build: {
            commands: [
              'env',
              'export TAG=latest',
              'echo "Logging Into Amazon ECR" ',
              'aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com'
            ]
          },
          build: {
            commands: [
              'cd node-app',
              'echo "Building Docker Image"',
              `docker build -t $ECR_REPO_URI:$TAG .`,
              'echo "Tagging Docker Image" ',
            ]
          },
          post_build: {
            commands: [
              'echo "in post-build stage"',
              'echo "Pushing"',
              'docker push $ECR_REPO_URI:$TAG',
              'cd ..',
              "printf '[{\"name\":\"node-app\",\"imageUri\":\"%s\"}]' $ECR_REPO_URI:$TAG > imagedefinitions.json",
              "pwd; ls -al; cat imagedefinitions.json"
            ]
          }
        },
        artifacts: {
          files: [
            'imagedefinitions.json'
          ]
        }
      })
    });


    
    /**
     * PIPELINE ACTIONS
     */

    const sourceOutput = new codepipeline.Artifact();
    const buildOutput = new codepipeline.Artifact();
    const nameOfGithubPersonTokenParameterAsString = githubPersonalTokenSecretName.valueAsString
    
    
    const sourceAction = new codepipeline_actions.GitHubSourceAction({
      actionName: 'github_source',
      owner: githubUserName.valueAsString,
      repo: githubRepository.valueAsString,
      branch: 'main',
      oauthToken: cdk.SecretValue.secretsManager(nameOfGithubPersonTokenParameterAsString),
      output: sourceOutput
    });

    const buildAction = new codepipeline_actions.CodeBuildAction({
      actionName: 'codebuild',
      project: project,
      input: sourceOutput,
      outputs: [buildOutput], // optional
    });

    const manualApprovalAction = new codepipeline_actions.ManualApprovalAction({
      actionName: 'approve',
      externalEntityLink: 'https://this_would_be_a_link_to_a_commit.com',
      additionalInformation: 'This is information that would be sent to the sns topic if sending an email'
    });

    const deployAction = new codepipeline_actions.EcsDeployAction({
      actionName: 'deployAction',
      service: fargateService.service,
      imageFile: new codepipeline.ArtifactPath(buildOutput, `imagedefinitions.json`)
    });



    /**
     * CODE PIPELINE STAGES
     * These are a 1:1 mapping with the stages that show in the pipelines UI
     */


    //Comment out approve action if desired. Can make an email with link to approval link with codepipeline_actions if desired
    new codepipeline.Pipeline(this, 'myecspipeline', {
      stages: [
        {
          stageName: 'source',
          actions: [sourceAction],
        },
        {
          stageName: 'build',
          actions: [buildAction],
        },
        {
          stageName: 'approve',
          actions: [manualApprovalAction],
        },
        {
          stageName: 'deploy-to-ecs',
          actions: [deployAction],
        }
      ]
    });

    //This is the magic
    ecrRepo.grantPullPush(project.role!)
    
    project.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        "ecs:describecluster",
        "ecr:getauthorizationtoken",
        "ecr:batchchecklayeravailability",
        "ecr:batchgetimage",
        "ecr:getdownloadurlforlayer"
        ],
      resources: [`${cluster.clusterArn}`],
    }));


    new cdk.CfnOutput(this, "image", { value: ecrRepo.repositoryUri+":latest"} )
    new cdk.CfnOutput(this, 'loadbalancerdns', { value: fargateService.loadBalancer.loadBalancerDnsName });
  }




}
