# Static Site Hosting (using AWS)

[![NPM Version](https://img.shields.io/npm/v/static-site-hosting.svg)](https://www.npmjs.com/package/static-site-hosting)
[![License](https://img.shields.io/github/license/onebytegone/static-site-hosting.svg)](./LICENSE)
[![Build Status](https://travis-ci.com/onebytegone/static-site-hosting.svg?branch=master)](https://travis-ci.com/onebytegone/static-site-hosting)
[![Coverage Status](https://coveralls.io/repos/github/onebytegone/static-site-hosting/badge.svg?branch=master)](https://coveralls.io/github/onebytegone/static-site-hosting?branch=master)
[![Dependency Status](https://david-dm.org/onebytegone/static-site-hosting.svg)](https://david-dm.org/onebytegone/static-site-hosting)
[![Dev Dependency Status](https://david-dm.org/onebytegone/static-site-hosting/dev-status.svg)](https://david-dm.org/onebytegone/static-site-hosting#info=devDependencies&view=table)
[![Conventional Commits](https://img.shields.io/badge/Conventional%20Commits-1.0.0-yellow.svg)](https://conventionalcommits.org)

## What?

This is a serverless static site hosting service build using Amazon S3, CloudFront, and
Route 53. It is deployed using the AWS Cloud Development Kit (AWS CDK).

## Why?

While it is possible to create the resources manually in the AWS Console, doing so is time
consuming and error prone. By having this hosting infrastructure as code, the resource
creation is automated and can easily be moved in a new AWS account or duplicated for a new
static site.

## Setup

### Prerequisites

   * Install the AWS CDK ([docs][cdk-getting-started])
   * Setup "shared" account resources
      * [SES Receipt Rule Set][ses-receipt-rule-set]
         * This app will add a rule to this rule set that forwards all received emails, on
           the given domain, to a provided SNS topic. This is important to have as  this
           app is having ACM use email to validate the domain certificate (An unscientific
           opinion says it's faster and a little easier than using DNS)
         * Since an account can only have one active receipt rule set, it isn't really
           practical for this CDK app to create the receipt rule set. As such, it is up to
           you to create this and add its name to your site config.
         * The name of this rule set is provided in the config as `sesReceiptRuleSetName`
      * [SNS topic][sns-topic]
         * This will be the topic that the SES rule will forward any emails sent to the
           domain to. If desired, you can subscribe an external email to this topic
           ([tutorial][sns-email-subscription]).
         * The ARN of the topic is provided in the config as `receivedEmailTopicArn`


[cdk-getting-started]: https://docs.aws.amazon.com/cdk/latest/guide/getting_started.html
[ses-receipt-rule-set]: https://docs.aws.amazon.com/ses/latest/DeveloperGuide/receiving-email-receipt-rule-set.html
[sns-topic]: https://docs.aws.amazon.com/sns/latest/dg/sns-tutorial-create-topic.html
[sns-email-subscription]: https://docs.aws.amazon.com/sns/latest/dg/sns-tutorial-create-subscribe-endpoint-to-topic.html

### Deployment

```
git clone TODO
cd static-site-hosting
npm install
cp domains/sample.yml domains/examplecom.yml
vi domains/examplecom.yml # See README.md#Site-Configuration
cdk deploy -c configPath=domains/examplecom.yml
# NOTE: The deploy will hang partway until you approve the certificate created by ACM
```

## Site Configuration

An example can be found at [`./domains/sample.yml`][./domains/sample.yml].

   * Account specific config
      * `sesReceiptRuleSetName`: The name of the active SES Receipt Rule Set in your
        account
      * `receivedEmailTopicArn`: The ARN of the SNS topic you want email sent to the
        domain to be forwarded to.
   * Site specific config
      * `domain`: The root domain of the static site to be hosted
      * `sites`: An array of sites (i.e. subdomains) to host
         * `subdomain`: The subdomain to host on S3

## License

This software is released under the MIT license. See [the license file](LICENSE) for more
details.
