import { Construct, Duration, Stack } from '@aws-cdk/core';
import { PolicyStatement } from '@aws-cdk/aws-iam';
import { IHostedZone, TxtRecord, MxRecord } from '@aws-cdk/aws-route53';
import { SingletonFunction, Runtime, InlineCode } from '@aws-cdk/aws-lambda';
import { readFileSync } from 'fs';
import { CustomResource, CustomResourceProvider } from '@aws-cdk/aws-cloudformation';

export interface SESDomainOwnershipVerificationProps {
   domain: string;
   hostedZone: IHostedZone;
}

export class SESDomainOwnershipVerification extends Construct {

   public constructor(scope: Construct, name: string, props: SESDomainOwnershipVerificationProps) {
      super(scope, name);

      const verifier = this._makeSimpleEmailServiceDomainVerifier(props.domain);

      // eslint-disable-next-line no-new
      new TxtRecord(this, 'SESDomainOwnershipVerificationRecordSet', {
         zone: props.hostedZone,
         recordName: `_amazonses.${props.domain}`,
         ttl: Duration.minutes(30),
         values: [ verifier.getAtt('VerificationToken').toString() ],
      });

      // eslint-disable-next-line no-new
      new MxRecord(this, 'SESEmailReceivingRecordSet', {
         zone: props.hostedZone,
         recordName: props.domain,
         ttl: Duration.minutes(30),
         values: [
            { priority: 10, hostName: `inbound-smtp.${Stack.of(this).region}.amazonaws.com` },
         ],
      });
   }

   private _makeSimpleEmailServiceDomainVerifier(domain: string): CustomResource {
      // Using InlineCode seems rather ugly. But for now, leaving as getting this "right"
      // will take a fair amount of setup. Note that using inline code automagically makes
      // cfn-response work.
      // https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/cfn-lambda-function-code-cfnresponsemodule.html

      const codePath = 'src/custom-resources/ses-domain-ownership-verification/SESDomainOwnershipVerificationHandler.js',
            code = readFileSync(codePath, { encoding: 'utf-8' }) as string;

      const lambda = new SingletonFunction(this, 'SimpleEmailServiceDomainVerifierLambda', {
         functionName: `${Stack.of(this).stackName}-ses-domain-verifier`,
         uuid: '20a1397d-c250-4efe-b9e9-45ccfd229ebb',
         runtime: Runtime.NODEJS_8_10,
         code: new InlineCode(code),
         handler: 'index.handler',
      });

      lambda.addToRolePolicy(new PolicyStatement({
         actions: [ 'ses:VerifyDomainIdentity', 'ses:DeleteIdentity' ],
         resources: [ '*' ],
      }));

      return new CustomResource(this, 'SimpleEmailServiceDomainVerifier', {
         provider: CustomResourceProvider.lambda(lambda),
         properties: {
            Domain: domain,
         },
      });
   }

}
