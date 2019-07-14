import { Stack, Construct, StackProps, Duration } from '@aws-cdk/core';
import { HostedZone, IHostedZone, RecordTarget, ARecord } from '@aws-cdk/aws-route53';
import { CloudFrontTarget } from '@aws-cdk/aws-route53-targets';
import { PolicyStatement, Effect, CanonicalUserPrincipal } from '@aws-cdk/aws-iam';
import { Certificate } from '@aws-cdk/aws-certificatemanager';
import { Bucket, BucketPolicy } from '@aws-cdk/aws-s3';
import { ReceiptRule, ReceiptRuleSet, ReceiptRuleSnsAction } from '@aws-cdk/aws-ses';
import {
   CfnCloudFrontOriginAccessIdentity,
   CloudFrontAllowedCachedMethods,
   CloudFrontWebDistribution,
   HttpVersion,
   PriceClass,
   SecurityPolicyProtocol,
   SSLMethod,
   ViewerProtocolPolicy,
} from '@aws-cdk/aws-cloudfront';
import { SESDomainOwnershipVerification } from '../custom-resources/ses-domain-ownership-verification/SESDomainOwnershipVerification';
import { Topic } from '@aws-cdk/aws-sns';

interface StaticSiteConfig extends StackProps {
   subdomain: string;
}

interface StaticSiteStackProps extends StackProps {
   rootDomain: string;
   sesReceiptRuleSetName: string;
   receivedEmailTopicArn: string;
   sites: StaticSiteConfig[];
}

export default class StaticSiteStack extends Stack {

   public constructor(scope: Construct | undefined, name: string | undefined, props: StaticSiteStackProps) {
      super(scope, name, props);

      const hostedZone = new HostedZone(this, 'HostedZone', {
         zoneName: props.rootDomain,
      });

      const originAccessIdentity = new CfnCloudFrontOriginAccessIdentity(this, 'WebsiteOriginAccessIdentity', {
         cloudFrontOriginAccessIdentityConfig: {
            comment: this.node.path, // TODO: Better value?
         },
      });

      this._setupDomainEmailForwarding({
         domain: props.rootDomain,
         hostedZone: hostedZone,
         sesReceiptRuleSetName: props.sesReceiptRuleSetName,
         receivedEmailTopicArn: props.receivedEmailTopicArn,
      });

      const certificate = new Certificate(this, 'DomainCertificate', {
         domainName: `*.${props.rootDomain}`,
         subjectAlternativeNames: [ props.rootDomain ],
      });

      // TODO: Lock down so a distribution can't access the files of another subdomain
      const hostingBucket = this._makeHostingBucket(props.rootDomain, originAccessIdentity),
            logBucket = this._makeLogBucket(props.rootDomain);

      props.sites.forEach((site) => {
         const primaryDomain = this._getFullDomainForSite(props.rootDomain, site),
               domainNames = [ primaryDomain ];

         if (site.subdomain === 'www') {
            domainNames.push(props.rootDomain);
         }

         const distribution = new CloudFrontWebDistribution(this, `Distribution-${primaryDomain.replace(/\./g, '')}`, {
            viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            priceClass: PriceClass.PRICE_CLASS_100,
            httpVersion: HttpVersion.HTTP2,
            defaultRootObject: 'index.html',
            aliasConfiguration: {
               acmCertRef: certificate.certificateArn,
               names: domainNames,
               sslMethod: SSLMethod.SNI,
               securityPolicy: SecurityPolicyProtocol.TLS_V1_1_2016,
            },
            originConfigs: [
               {
                  s3OriginSource: {
                     s3BucketSource: hostingBucket,
                     originAccessIdentityId: originAccessIdentity.ref,
                  },
                  originPath: `/${site.subdomain}`,
                  behaviors: [
                     {
                        isDefaultBehavior: true,
                        cachedMethods: CloudFrontAllowedCachedMethods.GET_HEAD,
                        defaultTtl: Duration.minutes(10),
                        maxTtl: Duration.minutes(10),
                        compress: true,
                        forwardedValues: {
                           queryString: true,
                           cookies: {
                              forward: 'none',
                           },
                        },
                     },
                  ],
               },
            ],
            loggingConfig: {
               bucket: logBucket,
               includeCookies: false,
               prefix: 'cloudfront',
            },
         });

         domainNames.forEach((domainName) => {
            // eslint-disable-next-line no-new
            new ARecord(this, `RecordSet-${domainName.replace(/\./g, '')}`, {
               recordName: domainName,
               zone: hostedZone,
               target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
            });
         });
      });
   }

   private _setupDomainEmailForwarding(props: {
      domain: string;
      hostedZone: IHostedZone;
      sesReceiptRuleSetName: string;
      receivedEmailTopicArn: string;
   }): void {
      // eslint-disable-next-line no-new
      new SESDomainOwnershipVerification(this, 'SESDomainOwnershipVerification', {
         domain: props.domain,
         hostedZone: props.hostedZone,
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

   private _makeHostingBucket(domain: string, originAccessIdentity: CfnCloudFrontOriginAccessIdentity): Bucket {
      const bucket = new Bucket(this, 'HostingBucket', {
         bucketName: `static-site-hosting-${domain}`,
         websiteIndexDocument: 'index.html',
         websiteErrorDocument: 'error.html',
         blockPublicAccess: {
            blockPublicAcls: true,
            blockPublicPolicy: true,
            ignorePublicAcls: true,
            restrictPublicBuckets: true,
         },
      });

      const bucketPolicy = new BucketPolicy(this, 'SiteBucketPolicy', {
         bucket: bucket,
      });

      const onlyAllowCloudFrontUser = new PolicyStatement({
         effect: Effect.ALLOW,
         actions: [ 's3:GetObject' ],
         resources: [ bucket.arnForObjects('*') ],
         principals: [ new CanonicalUserPrincipal(originAccessIdentity.attrS3CanonicalUserId) ],
      });

      bucketPolicy.document.addStatements(onlyAllowCloudFrontUser);

      return bucket;
   }

   private _makeLogBucket(domain: string): Bucket {
      const bucket = new Bucket(this, 'LogBucket', {
         bucketName: `static-site-logs-${domain}`,
         blockPublicAccess: {
            blockPublicAcls: true,
            blockPublicPolicy: true,
            ignorePublicAcls: true,
            restrictPublicBuckets: true,
         },
         lifecycleRules: [
            {
               id: 'DeleteOldLogs',
               enabled: true,
               expiration: Duration.days(30),
            },
         ],
      });

      return bucket;
   }

   private _getFullDomainForSite(rootDomain: string, site: StaticSiteConfig): string {
      return site.subdomain ? `${site.subdomain}.${rootDomain}` : rootDomain;
   }

}
