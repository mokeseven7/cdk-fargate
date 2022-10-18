# Main Application 

You are free to fill the "node-app" directory with ALL the files, and ALL the folders until your hearts content. SO MANY FOLDERS!

## Deployment 

Once the inital infrastructure has been deployed, any changes that are pushed to master will result in this dockerfile being rebuilt, and deployed to ecs. The same dockerfile is used to faciliate local development, as is sihpped to production. See the build pipeline spec in `ecs_cdk_stack.ts` for more information on that peice. 

## Local Development

1. Ensure docker is running on your machine
2. Build the container, optionally tagging it if desired

Build without a tag:
``` 
docker build . 
```

Build With A Tag:
```
docker build . -t <your username>/node-web-app
```

3. Run the container, binding to port 5000.
``` 
docker run -p 5000:5000 
```

If you used a tag in step 2, make sure to include it with the `-d` command line flag:

``` 
docker run -p 5000:5000 -d <your username>/node-web-app
```