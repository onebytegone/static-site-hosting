import { Stack, Construct, StackProps } from '@aws-cdk/core';
import { HostedZone } from '@aws-cdk/aws-route53';
import { ReceiptRule, ReceiptRuleSet, ReceiptRuleSnsAction } from '@aws-cdk/aws-ses';
import { SESDomainOwnershipVerification } from '../custom-resources/ses-domain-ownership-verification/SESDomainOwnershipVerification';
import { Topic } from '@aws-cdk/aws-sns';

interface DomainResourcesStackProps extends StackProps {
   domain: string;
   sesReceiptRuleSetName: string;
   receivedEmailTopicArn: string;
}

export default class DomainResourcesStack extends Stack {

   public readonly hostedZone: HostedZone;

   public constructor(scope: Construct | undefined, name: string | undefined, props: DomainResourcesStackProps) {
      super(scope, name, props);

      this.hostedZone = new HostedZone(this, 'HostedZone', {
         zoneName: props.domain,
      });

      // eslint-disable-next-line no-new
      new SESDomainOwnershipVerification(this, 'SESDomainOwnershipVerification', {
         domain: props.domain,
         hostedZone: this.hostedZone,
      });

      // eslint-disable-next-line no-new
      new ReceiptRule(this, 'ReceiptRule', {
         ruleSet: ReceiptRuleSet.fromReceiptRuleSetName(this, 'ReceiptRuleSet', props.sesReceiptRuleSetName),
         receiptRuleName: props.domain,
         recipients: [ props.domain ],
         scanEnabled: true,
         actions: [
            new ReceiptRuleSnsAction({
               topic: Topic.fromTopicArn(this, 'ValidationEmailTopic', props.receivedEmailTopicArn),
            }),
         ],
      });
   }

}
