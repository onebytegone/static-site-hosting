import { App } from '@aws-cdk/core';
import StaticSiteStack from './stacks/StaticSiteStack';
import { isString, promisify } from 'util';
import fs from 'fs';
import yaml from 'js-yaml';

const readFile = promisify(fs.readFile);

interface StaticSiteHostingConfig {
   domain: string;
   sesReceiptRuleSetName: string;
   receivedEmailTopicArn: string;
   sites: {
      subdomain: string;
   }[];
}

(async function() {
   const app = new App(),
         configPath = app.node.tryGetContext('configPath');

   if (!isString(configPath)) {
      throw new Error('Was not provided site config, please see README.md#Site-Configuration');
   }

   // TODO: Add better type checking here
   const config = yaml.safeLoad(await readFile(configPath, 'utf8')) as StaticSiteHostingConfig,
         stackNameSafeDomain = config.domain.replace(/\./g, '');

   // eslint-disable-next-line no-new
   new StaticSiteStack(app, 'StaticSite', {
      stackName: `static-site-hosting-${stackNameSafeDomain}`,
      rootDomain: config.domain,
      sesReceiptRuleSetName: config.sesReceiptRuleSetName,
      receivedEmailTopicArn: config.receivedEmailTopicArn,
      sites: config.sites,
   });

   app.synth();
}());
