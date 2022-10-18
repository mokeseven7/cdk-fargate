import * as cdk from 'aws-cdk-lib';
import { Template,  } from 'aws-cdk-lib/assertions';
import {EcsCdkStack} from '../lib/ecs-cdk-stack';

let template:Template;

beforeAll(() => {
    process.env.CDK_DEFAULT_ACCOUNT = '123456789012';
    process.env.CDK_DEFAULT_REGION = 'us-east-1';
    
    const app = new cdk.App();
    
    
    const testStack = new EcsCdkStack(app, 'EcsTestStack', {
        env: {
            account: process.env.CDK_DEFAULT_ACCOUNT,
            region: process.env.CDK_DEFAULT_REGION,
        },
    });
    
    template = Template.fromStack(testStack);
 });


test('[AWS::ECR::Repository]:[Created] - ECR Respository', () => {
    template.resourceCountIs('AWS::ECR::Repository', 1);
});

test('[CodePipeline::Webhook]:[Created] - Github Webhook', () => {
    template.resourceCountIs('AWS::CodePipeline::Webhook', 1);
});

test('[CodePipeline::Pipeline]:[Created] - Github Webhook', () => {
    template.resourceCountIs('AWS::CodePipeline::Pipeline', 1);
});

test('[CodePipeline::Webhook]:[Properties]', () => {
    template.hasResourceProperties('AWS::CodePipeline::Webhook', {
        Authentication: "GITHUB_HMAC",
    })
});

