// Neara Infrastructure Task

import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

const stack = pulumi.getStack();

const tags = { Name: "neara-task" };

// Create VPC and subnets
const vpc = new aws.ec2.Vpc("andy-vpc", {
  cidrBlock: "10.0.0.0/16",
  tags: tags,
});

const privateSubnet = new aws.ec2.Subnet("private-subnet", {
  vpcId: vpc.id,
  cidrBlock: "10.0.1.0/24",
  tags: tags,
});

const publicSubnet = new aws.ec2.Subnet("public-subnet", {
  vpcId: vpc.id,
  cidrBlock: "10.0.2.0/24",
  tags: tags,
});

// Lambda definitions
const lambdaRole = new aws.iam.Role("info-handler-role", {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal(
    aws.iam.Principals.LambdaPrincipal
  ),
  tags: tags,
});

const lambdaRoleAttachment = new aws.iam.RolePolicyAttachment(
  "lambdaRoleAttachment",
  {
    role: lambdaRole,
    policyArn: aws.iam.ManagedPolicy.AWSLambdaBasicExecutionRole,
  }
);

const infoHandler = new aws.lambda.Function("info-handler", {
  role: lambdaRole.arn,
  runtime: aws.lambda.Runtime.Python3d9,
  code: new pulumi.asset.FileArchive("./lambda/main.py.zip"),
  handler: "main.info_handler", // fileName.methodName
  tags: tags,
});

// API Gateway
const securityGroup = new aws.ec2.SecurityGroup("api-gateway-security-group", {
  vpcId: vpc.id,
  ingress: [
    {
      description: "HTTP inbound",
      fromPort: 80,
      toPort: 80,
      protocol: "tcp",
      cidrBlocks: ["0.0.0.0/0"],
    },
  ],
  tags: tags,
});

const vpcLink = new aws.apigatewayv2.VpcLink("andy-vpc-link", {
  subnetIds: [privateSubnet.id],
  securityGroupIds: [securityGroup.id],
  tags: tags,
});

const api = new aws.apigatewayv2.Api("andy-api-gateway", {
  protocolType: "HTTP",
  tags: tags,
});

// Give access to Api Gateway to use Lambda
const withApi = new aws.lambda.Permission(
  "lambdaPermission",
  {
    action: "lambda:InvokeFunction",
    principal: "apigateway.amazonaws.com",
    function: infoHandler,
    sourceArn: pulumi.interpolate`${api.executionArn}/*/*`,
  },
  { dependsOn: [api, infoHandler] }
);

const integration = new aws.apigatewayv2.Integration("andy-integration", {
  apiId: api.id,
  integrationType: "AWS_PROXY",
  integrationUri: infoHandler.arn,
  integrationMethod: "GET",
});

const route = new aws.apigatewayv2.Route("get-info-route", {
  apiId: api.id,
  routeKey: "GET /info",
  target: integration.id.apply((id) => "integrations/" + id),
});

const stage = new aws.apigatewayv2.Stage("api-stage", {
  apiId: api.id,
  name: stack,
  autoDeploy: true,
});

// Create internet gateway, nat gateway and edit route tables
const igw = new aws.ec2.InternetGateway("igw", {
  vpcId: vpc.id,
  tags: tags,
});

const natEip = new aws.ec2.Eip("nat-eip", {
  vpc: true,
  tags: tags,
});

const natgw = new aws.ec2.NatGateway("natgw", {
  subnetId: publicSubnet.id,
  allocationId: natEip.id,
  tags: tags,
});

const privateRouteTable = new aws.ec2.RouteTable("private-route-table", {
  vpcId: vpc.id,
  routes: [{ cidrBlock: "0.0.0.0/0", natGatewayId: natgw.id }],
  tags: tags,
});

const privateAssociation = new aws.ec2.RouteTableAssociation(
  "private-subnet-association",
  {
    routeTableId: privateRouteTable.id,
    subnetId: privateSubnet.id,
  }
);

const publicRouteTable = new aws.ec2.RouteTable("public-route-table", {
  vpcId: vpc.id,
  routes: [{ cidrBlock: "0.0.0.0/0", gatewayId: igw.id }],
  tags: tags,
});

const mainAssociation = new aws.ec2.MainRouteTableAssociation(
  "main-route-association",
  {
    routeTableId: publicRouteTable.id,
    vpcId: vpc.id,
  }
);

// CloudWatch integration

// Log info
export const privateSubnetCidr = privateSubnet.cidrBlock;
export const publicSubnetCidr = publicSubnet.cidrBlock;
export const lambdaFunctionArn = infoHandler.arn;
export const endpoint = api.apiEndpoint;
