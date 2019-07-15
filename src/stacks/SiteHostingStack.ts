import { Stack, Construct, StackProps, Duration } from '@aws-cdk/core';
import { HostedZone, RecordTarget, ARecord } from '@aws-cdk/aws-route53';
import { CloudFrontTarget } from '@aws-cdk/aws-route53-targets';
import {
   PolicyStatement,
   Effect,
   CanonicalUserPrincipal,
   ServicePrincipal,
   CompositePrincipal,
   Role,
   ManagedPolicy,
} from '@aws-cdk/aws-iam';
import { Certificate } from '@aws-cdk/aws-certificatemanager';
import { Bucket, BucketPolicy } from '@aws-cdk/aws-s3';
import {
   CfnCloudFrontOriginAccessIdentity,
   CloudFrontAllowedCachedMethods,
   CloudFrontWebDistribution,
   HttpVersion,
   PriceClass,
   SecurityPolicyProtocol,
   SSLMethod,
   ViewerProtocolPolicy,
   LambdaEdgeEventType,
} from '@aws-cdk/aws-cloudfront';
import { readFileSync } from 'fs';
import { InlineCode, Runtime, Version, Function as LambdaFunction } from '@aws-cdk/aws-lambda';
import { createHash } from 'crypto';

interface SiteConfig extends StackProps {
   subdomain: string;
}

interface SiteHostingStackProps extends StackProps {
   hostedZone: HostedZone;
   sesReceiptRuleSetName: string;
   receivedEmailTopicArn: string;
   sites: SiteConfig[];
}

export default class SiteHostingStack extends Stack {

   public constructor(scope: Construct | undefined, name: string | undefined, props: SiteHostingStackProps) {
      super(scope, name, props);

      const rootDomain = props.hostedZone.zoneName;

      // This cert is more for the domain. However, since the domain needs to be "setup"
      // in order for the email rules to work, putting this cert in the hosting stack as
      // this stack gets deployed after the DomainResourcesStack.
      const certificate = new Certificate(this, 'DomainCertificate', {
         domainName: `*.${rootDomain}`,
         subjectAlternativeNames: [ rootDomain ],
      });

      const originAccessIdentity = new CfnCloudFrontOriginAccessIdentity(this, 'WebsiteOriginAccessIdentity', {
         cloudFrontOriginAccessIdentityConfig: {
            comment: this.node.path, // TODO: Better value?
         },
      });

      // TODO: Lock down so a distribution can't access the files of another subdomain
      const hostingBucket = this._makeHostingBucket(rootDomain, originAccessIdentity),
            logBucket = this._makeLogBucket(rootDomain),
            directoryRootRewriter = this._makeDirectoryRootRewriter();

      props.sites.forEach((site) => {
         const primaryDomain = this._getFullDomainForSite(rootDomain, site),
               domainNames = [ primaryDomain ];

         if (site.subdomain === 'www') {
            domainNames.push(rootDomain);
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
                        lambdaFunctionAssociations: [
                           {
                              eventType: LambdaEdgeEventType.ORIGIN_REQUEST,
                              lambdaFunction: directoryRootRewriter,
                           },
                        ],
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
               zone: props.hostedZone,
               target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
            });
         });
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

   private _makeDirectoryRootRewriter(): Version {
      // Using InlineCode seems rather ugly. But for now, leaving as getting this "right"
      // will take a fair amount of setup.

      const codePath = 'src/functions/DirectoryRootRewriteHandler.js',
            code = readFileSync(codePath, { encoding: 'utf-8' }) as string,
            hash = createHash('sha256');

      hash.setEncoding('base64');
      hash.write(code);
      hash.end();

      const fn = new LambdaFunction(this, 'DirectoryRootRewriterLambda', {
         functionName: `${Stack.of(this).stackName}-directory-root-rewriter`,
         runtime: Runtime.NODEJS_8_10,
         code: new InlineCode(code),
         handler: 'index.handler',
         role: new Role(this, 'AllowLambdaToAssumeRole', {
            assumedBy: new CompositePrincipal(
               new ServicePrincipal('lambda.amazonaws.com'),
               new ServicePrincipal('edgelambda.amazonaws.com'),
            ),
            managedPolicies: [ ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole') ],
         }),
      });

      return new Version(this, `DirectoryRootRewriterVersion${hash.read()}`, {
         lambda: fn,
      });
   }

   private _getFullDomainForSite(rootDomain: string, site: SiteConfig): string {
      return site.subdomain ? `${site.subdomain}.${rootDomain}` : rootDomain;
   }

}
