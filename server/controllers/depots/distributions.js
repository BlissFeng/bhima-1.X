/**
* Depot Distributions Controller
*
* Implements full CRUD for creating distributions (consumptions).  This is an
* overloaded route, meaning it handles distributions to services, patients,
* losses and rummage sales.
*
* TODO -- complete the full CRUD described above.
*/

var db      = require('../../lib/db'),
    q       = require('q'),
    journal = require('../journal'),
    uuid    = require('../../lib/guid');

exports.createDistributions = createDistributions;

/**
* Create a distribution
*/
function createDistributions(depotId, body, session) {
  'use strict';

  var sql, fmap, queries,

      // create a new document id
      docId = uuid();

  // map to create specific distribution
  fmap = {
    'service' : createServiceDistribution,
    'patient' : createPatientDistribution,
    'loss'    : createLossDistribution,
    'rummage' : createRummageDistribution
  };

  // if the type does not map to one of the function above, reject with an error
  // ERR_INVALID_DISTRIBUTION_TYPE
  if (!fmap[body.type]) {
    return q.reject({
      code : 'ERR_INVALID_DISTRIBUTION_TYPE',
      reason : 'The distribution \'type\' property was not correctly set.'
   });
  }

  // TODO -- it turns out that we create n rows for each consumption and n rows
  // in the associated service/patient/loss/etc consumption table.  This seems
  // like it could/should be redesigned

  sql =
    'INSERT INTO consumption (uuid, depot_uuid, date, document_id, tracking_number, quantity, unit_price) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?);';

  queries = body.data.map(function (row) {
    row.id = uuid();

    return db.exec(sql, [row.id, depotId, row.date, docId, row.tracking_number, row.quantity, row.unit_price])
    .then(function () {
      return fmap[body.type](depotId, row);
    });
  });

  return q.all(queries)
  .then(function () {

    // FIXME -- this is currently only implemented for the service distribution type
    // write to the journal
    return writeToJournal(docId, session);
  })
  .then(function () {

    // send that data back up to the parent controller
    return docId;
  });
}

// FIXME
// poorly designed code to write to the journal
function writeToJournal(docId, session) {
  var dfd = q.defer();

  journal.request('distribution_service', docId, session.user.id, function (error, result) {
    if (error) { return dfd.reject(error); }
    return dfd.resolve(result);

  // FIXME
  // This API needs to change.
  }, undefined, session);

  return dfd.promise;
}

// create a patient distribution
function createPatientDistribution(depotId, item) {
  'use strict';

  // TODO
}

// create a service distribution
function createServiceDistribution(depotId, item) {
  'use strict';

  var sql =
    'INSERT INTO consumption_service VALUES (?, ?, ?);';

  return db.exec(sql, [uuid(), item.id, item.service_id]);
}

function createLossDistribution(depotId, item) {
  'use strict';

  // TODO
}


function createRummageDistribution(depotId, item) {
  'use strict';

  // TODO
}
