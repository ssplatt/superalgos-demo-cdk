import * as cdk from '@aws-cdk/core';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as ecs from '@aws-cdk/aws-ecs';
import * as elbv2 from '@aws-cdk/aws-elasticloadbalancingv2';
import * as iam from '@aws-cdk/aws-iam';
import * as logs from '@aws-cdk/aws-logs';
import { loadBalancerNameFromListenerArn } from '@aws-cdk/aws-elasticloadbalancingv2';

export class SuperalgosDemoStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const socketPort = 18041;
    const webPort = 34248;

    const vpc = new ec2.Vpc(this, "DemoVpc", {
      maxAzs: 2
    });

    const cluster = new ecs.Cluster(this, "SuperalgosCluster", {
      vpc: vpc
    });

    const securityGroup = new ec2.SecurityGroup(
      this,
      "superalgosSecurityGroup",
      {
        allowAllOutbound: true,
        securityGroupName: "superalgosSecurityGroup",
        vpc: vpc,
      }
    );

    securityGroup.connections.allowFromAnyIpv4(ec2.Port.tcp(socketPort));
    securityGroup.connections.allowFromAnyIpv4(ec2.Port.tcp(webPort));

    const logGroup = new logs.LogGroup(this, "superalgosLogGroup", {
      logGroupName: "/ecs/superalgos",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const logDriver = new ecs.AwsLogDriver({
      logGroup: logGroup,
      streamPrefix: "superalgos",
    });

    const taskrole = new iam.Role(this, "ecsTaskExecutionRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });

    taskrole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "service-role/AmazonECSTaskExecutionRolePolicy"
      )
    );

    const taskDefinition = new ecs.FargateTaskDefinition(
      this,
      "superalgosTaskDef",
      {
        memoryLimitMiB: 4096,
        cpu: 2048,
        taskRole: taskrole,
      }
    );

    const container = taskDefinition.addContainer(
      "superalgosContainer",
      {
        image: ecs.ContainerImage.fromRegistry("ghcr.io/superalgos/superalgos"),
        command: ['minMemo', 'demoMode'],
        logging: logDriver,
      }
    );

    container.addPortMappings({
      containerPort: socketPort
    });

    container.addPortMappings({
      containerPort: webPort
    });

    const service = new ecs.FargateService(this, "superalgosService", {
      cluster: cluster,
      taskDefinition: taskDefinition,
      assignPublicIp: false,
      desiredCount: 1,
      securityGroup: securityGroup
    });

    const loadBalancer = new elbv2.ApplicationLoadBalancer(
      this,
      "superagosALB",
      {
        vpc: vpc,
        internetFacing: true,
      }
    );

    const socketTargetGroup = new elbv2.ApplicationTargetGroup(
      this,
      "socketTargetGroup",
      {
        vpc: vpc,
        port: socketPort,
        protocol: elbv2.ApplicationProtocol.HTTP
      }
    );

    const webTargetGroup = new elbv2.ApplicationTargetGroup(
      this,
      "webTargetGroup",
      {
        vpc: vpc,
        port: webPort,
        protocol: elbv2.ApplicationProtocol.HTTP
      }
    );

    const socketTarget = service.loadBalancerTarget({
      containerName: container.containerName,
      containerPort: socketPort
    });

    const webTarget = service.loadBalancerTarget({
      containerName: container.containerName,
      containerPort: webPort
    });
    
    socketTargetGroup.addTarget(socketTarget);
    webTargetGroup.addTarget(webTarget);

    loadBalancer.addListener("socketListener", {
      port: socketPort,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultTargetGroups: [socketTargetGroup]
    });

    loadBalancer.addListener("webListener", {
      port: webPort,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultTargetGroups: [webTargetGroup]
    });
  }
}
