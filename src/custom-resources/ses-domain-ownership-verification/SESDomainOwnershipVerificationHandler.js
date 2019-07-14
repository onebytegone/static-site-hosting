'use strict';

const aws = require('aws-sdk'),
      response = require('cfn-response'),
      ses = new aws.SES();

class Verifier {

   doCreate(props) {
      return ses.verifyDomainIdentity({ Domain: props.Domain }).promise()
         .then(function(resp) {
            return { PhysicalResourceId: props.Domain, VerificationToken: resp.VerificationToken };
         });
   }

   doDelete(props) {
      return ses.deleteIdentity({ Identity: props.Domain }).promise();
   }

   doUpdate(resourceID, props, oldProps) {
      return this.doDelete(oldProps.Domain).then(this.doCreate.bind(this, props));
   }

}

module.exports = {

   handler: function(evt, ctx) {
      // based on: https://github.com/silvermine/cloudformation-custom-resources/blob/c591424063f8e539e5b90c4975abcb7b5c0f2929/src/SimpleEmailServiceDomainVerification.js

      // eslint-disable-next-line no-console
      console.log('custom resource event:', JSON.stringify(evt, null, 3));

      const verifier = new Verifier();

      let promise = Promise.resolve();

      if (evt.RequestType === 'Create') {
         promise = verifier.doCreate(evt.ResourceProperties);
      } else if (evt.RequestType === 'Delete') {
         promise = verifier.doDelete(evt.ResourceProperties);
      } else if (evt.RequestType === 'Update') {
         promise = verifier.doUpdate(evt.PhysicalResourceId, evt.ResourceProperties, evt.OldResourceProperties);
      }

      // Not returning the promise as `response.send` will call `ctx.done()`
      promise
         .then((data) => {
            response.send(evt, ctx, response.SUCCESS, data);
         })
         .catch((err) => {
            response.send(evt, ctx, response.FAILED, { error: err });
         });
   },

};
