'use strict';

module.exports = {

   handler: function(evt, context, cb) {
      const req = evt.Records[0].cf.request;

      if (req.uri && req.uri.length && req.uri.substring(req.uri.length - 1) === '/') {
         req.uri = req.uri + 'index.html';
      }

      cb(null, req);
   },

};
