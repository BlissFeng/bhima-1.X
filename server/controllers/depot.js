/**
* Depot Controller
*
* This controller is mostly responsible for depot-dependent stock queries.  Most
* routes require that a depot ID is specified.  Any route without a depot ID
* might be better positioned in the /inventory/ controller.
*
* Exposed routes:
*   /depots/:depotId/distributions
*   /depots/:depotId/distributions/:uuid
*/

var db = require('./../lib/db');

// expose routes
exports.getDistributions = getDistributions;
exports.getDistributionsById = getDistributionsById;

/**
* GET /depots/:uuid/distributions
* Fetches distributions (equiv. consumptions) for the given depot uuid.  Allows
* the following query options:
*   start - start date
*   end   - end date
*   type  - type of distribution {service|patient|loss|rummage}. Defaults to
*           all distributions, regardless of type.
*
* NOTE - this query does not filter for uncanceled sales.  You will have to
* handle those yourselves in your controllers.
*
* @function getDistributions 
*/
function getDistributions(req, res, next) {
  'use strict';

  var sql,
      options = req.query;

  // the sql executed depends on the type of consumption
  // defaults to all consumptions
  switch (options.type) {

    // filter on distributions to patients
    // TODO - this query is suboptimal.  Perhaps rewrite with multiple subqueries
    case 'patients':
    case 'patient':
      sql =
        'SELECT c.uuid, c.document_id, COUNT(c.document_id) AS total, ' +
          'cp.patient_uuid, p.uuid AS patientId, p.first_name, p.last_name, ' +
          'p.middle_name, d.text, d.uuid AS depotId, ' +
          'CONCAT(pr.abbr, p.reference) AS patient, c.date, i.text as label, ' +
          'sale.invoice, cp.sale_uuid AS saleId, c.canceled ' +
        'FROM consumption_patient AS cp ' +
        'JOIN consumption AS c ON c.uuid = cp.consumption_uuid ' +
        'JOIN patient AS p ON p.uuid = cp.patient_uuid ' +
        'JOIN project AS pr ON p.project_id = pr.id ' +
        'JOIN depot AS d ON d.uuid = c.depot_uuid ' +
        'JOIN stock AS s ON s.tracking_number = c.tracking_number ' +
        'JOIN inventory AS i ON i.uuid = s.inventory_uuid ' +
        'JOIN (' +
          'SELECT sale.uuid, CONCAT(project.abbr, sale.reference) AS invoice ' +
          'FROM sale JOIN project ON ' +
            'sale.project_id = project.id' +
        ') AS sale ON sale.uuid = c.document_id ' +
        'WHERE d.uuid = ? AND c.date BETWEEN DATE(?) AND DATE(?) ' +
        'GROUP BY c.document_id ' +
        'ORDER BY c.date DESC, p.first_name ASC, p.last_name ASC;';
      break;

    // get distributions to services
    case 'services':
    case 'service':
      sql =
        'SELECT c.uuid, c.document_id, COUNT(c.document_id) AS total, ' +
        'cs.service_id, service.name, c.date, d.text, d.uuid AS depotId, ' +
        'i.text AS label, c.canceled ' +
        'FROM consumption_service AS cs ' +
        'JOIN consumption AS c ON c.uuid = cs.consumption_uuid ' +
        'JOIN service ON service.id = cs.service_id ' +
        'JOIN depot AS d ON d.uuid = c.depot_uuid ' +
        'JOIN stock ON stock.tracking_number = c.tracking_number ' +
        'JOIN inventory AS i ON i.uuid = stock.inventory_uuid ' +
        'WHERE depot.uuid = ? AND c.date BETWEEN DATE(?) AND DATE(?) ' +
        'GROUP BY c.document_id ' +
        'ORDER BY c.date DESC, service.name ASC;';
      break;

    // TODO - this should find all consumption rummages for this depot
    case 'rummage':
      sql =
        'SELECT c.uuid, cr.document_uuid AS voucher, ' +
          'COUNT(c.document_id) AS total, c.date, d.text, d.uuid AS depotId ' +
          'i.text AS label, c.canceled ' +
        'FROM consumption_rummage AS cr ' +
        'JOIN consumption AS c ON c.uuid = cr.consumption_uuid ' +
        'JOIN depot ON depot.uuid = c.depot_uuid ' +
        'JOIN stock ON stock.tracking_number = c.tracking_number ' +
        'JOIN inventory AS i ON i.uuid = stock.inventory_uuid ' +
        'WHERE depot.uuid = ? AND c.date BETWEEN DATE(?) AND DATE(?) ' +
        'GROUP BY c.document_id ' +
        'ORDER BY c.date DESC;';
      break;

    // TODO - this should find all consumption losses for this depot
    case 'loss' :
    case 'losses':
      sql =
        'SELECT c.uuid, cl.document_uuid AS voucher, ' +
          'COUNT(c.document_id) AS total, c.date, d.text, d.uuid AS depotId ' +
          'i.text AS label, c.canceled ' +
        'FROM consumption_loss AS cl ' +
        'JOIN consumption AS c ON c.uuid = cl.consumption_uuid ' +
        'JOIN depot AS d ON d.uuid = c.depot_uuid ' +
        'JOIN stock AS s ON s.tracking_number = c.tracking_number ' +
        'JOIN inventory AS i ON i.uuid = s.inventory_uuid ' +
        'WHERE depot.uuid = ? AND c.date BETWEEN DATE(?) AND DATE(?) ' +
        'GROUP BY c.document_id ' +
        'ORDER BY c.date DESC;';
      break;

    // TODO - this should find all consumptions for this depot
    default:
      sql =
        'SELECT c.uuid, SUM(c.quantity) AS quantity, SUM(c.unit_price) AS price ' +
          'COUNT(c.document_id) AS total, c.date, d.text, ' +
          'd.uuid AS depotId, i.text AS label, c.canceled ' +
        'FROM consumption AS c ' +
        'JOIN depot AS d ON d.uuid = c.depot_uuid ' +
        'JOIN stock AS s ON s.tracking_number = c.tracking_number ' +
        'JOIN inventory AS i ON i.uuid = s.inventory_uuid ' +
        'WHERE d.uuid = ? AND c.date BETWEEN DATE(?) AND DATE(?) ' +
        'GROUP BY c.document_id ' +
        'ORDER BY c.date DESC;';
      break;
  }

  db.exec(sql, [req.params.depotId, options.start, options.end])
  .then(function (rows) {
    res.status(200).json(rows);
  })
  .catch(next)
  .done();
}

function getDistributionsById(req, res, next) {
  'use strict';

  var sql,
      uuid = req.params.uuid;

  sql =
    'SELECT c.uuid, c.quantity, c.document_id AS total, c.date, ' +
      'd.text, d.uuid AS depotId, i.text AS label, c.canceled ' +
    'FROM consumption AS c ' +
    'JOIN depot AS d ON d.uuid = c.depot_uuid ' +
    'JOIN stock AS s ON s.tracking_number = c.tracking_number ' +
    'JOIN inventory AS i ON i.uuid = s.inventory_uuid ' +
    'WHERE d.uuid = ? AND c.uuid = ?' +
    'ORDER BY c.date DESC;';

  db.exec(sql, [req.params.depotId, uuid])
  .then(function (rows) {
    if (!rows) {
      return res.status(404).json({
        code : 'ERR_NO_CONSUMPTION',
        reason : 'Could not find a consumption by uuid: ' + uuid
      });
    }

    res.status(200).json(rows);
  })
  .catch(next)
  .done();
}

/*
// TODO this is old code, which may still be valuable!  We should try
// to recoup some of this code in the futuer.
module.exports = function () {
  'use strict';

  // These routes are to investigate drugs in particular depots (or all).
  // URL root (/inventory/depot/:depotid/) {
  //    /drug/:code           => list of all lots of drug with code code
  //    /lot/:tracking_number => only details of the lot with tracking_number
  //    /lots                 => list of all drugs by lot
  //    /drugs                => lots of all drugs by code
  // }

  function findDrugsInDepot (array, depot) {
    // reduce quantities in an array of entry, exit depots
    // to give a total quantity for each depot for each
    // tracking_number

    console.log('\n\n Has reference to Store', Store, '\n\n');
    // contains { tracking_number, quantity, expiration_date }
    var _depot, store = new Store({ identifier : 'tracking_number' });

    console.log('created new store instance', store, '\n\n');
    // depot ID is now a UUID
    _depot = depot;
    // _depot = Number(depot);

    array
    .filter(function (transaction) {
      var filterDepot = transaction.depot_entry === _depot || transaction.depot_exit === _depot;
      var filterEmpty = transaction.quantity > 0;

      return filterEmpty && filterDepot;
    })
    .forEach(function (transaction) {
      if (!store.get(transaction.tracking_number)) {
        store.post(transaction);
        // store.post({ tracking_number : transaction.tracking_number, lot_number : transaction.lot_number, stock_description : transaction.stock_description, quantity : transaction.quantity , code : transaction.code, expiration_date : transaction.expiration_date });
      }
      // var item = store.get(transaction.tracking_number);
      // item.quantity += transaction.depot_entry === _depot ? transaction.quantity : -1 * transaction.quantity;
    });

    return store;
  }

  function byLot (depot, id) {
    var sql, _depot, _id;

    _depot = sanitize.escape(depot);
    _id = sanitize.escape(id);

    sql =
      'SELECT stock.tracking_number, stock.lot_number, movement.depot_entry, movement.depot_exit, SUM(movement.quantity) AS quantity, ' +
        'stock.expiration_date, code, inventory.text as stock_description ' +
      'FROM inventory JOIN stock JOIN movement ON ' +
        'inventory.uuid = stock.inventory_uuid AND stock.tracking_number = movement.tracking_number ' +
      'WHERE (movement.depot_entry = ' + _depot + ' OR movement.depot_exit = ' + _depot + ') ' +
      'AND stock.tracking_number = ' + _id + ' ' +
      'GROUP BY stock.tracking_number;';

    return db.exec(sql)
    .then(function (rows) {
      var store = findDrugsInDepot(rows, depot);
      return q(store.data);
    });
  }

  function byCode (depot, code) {
    var sql, _depot, _code;

    _depot = sanitize.escape(depot);
    _code = sanitize.escape(code);

    sql =
      'SELECT stock.tracking_number, stock.lot_number, calculateMovement.depot_entry, calculateMovement.depot_exit, ' +
        'SUM(CASE WHEN calculateMovement.depot_entry =' + _depot + ' THEN calculateMovement.quantity ELSE -calculateMovement.quantity END) AS quantity, ' +
        'stock.expiration_date, code ' +
      'FROM inventory JOIN stock JOIN ' +
      // ' movement ON ' +
      '(SELECT uuid, depot_entry, depot_exit, tracking_number, quantity, date ' +
      'FROM movement ' +
      'UNION ' +
      'SELECT uuid, null as depot_entry, depot_uuid as depot_exit, tracking_number, quantity, date  ' +
      'FROM consumption ' +
      'UNION ' +
      'SELECT uuid, null as depot_entry, depot_uuid as depot_exit, tracking_number, (quantity * (-1)) AS quantity, date ' +
      'FROM consumption_reversing ) as calculateMovement ON ' +
        'inventory.uuid = stock.inventory_uuid AND stock.tracking_number = calculateMovement.tracking_number ' +
      'WHERE (calculateMovement.depot_entry = ' + _depot + ' OR calculateMovement.depot_exit = ' + _depot + ') ' +
      'AND inventory.code = ' + _code +
      'GROUP BY stock.tracking_number;';

    return db.exec(sql)
    .then(function (rows) {
      var store = findDrugsInDepot(rows, depot);
      return q(store.data);
    });
  }

  function byAllLots (depot) {
    var sql, _depot;

    _depot = sanitize.escape(depot);

    sql =
      'SELECT stock.tracking_number, stock.lot_number, calculateMovement.depot_entry, calculateMovement.depot_exit, ' +
        'SUM(CASE WHEN calculateMovement.depot_entry =' + _depot + ' THEN calculateMovement.quantity ELSE -calculateMovement.quantity END) AS quantity, ' +
        'stock.expiration_date, code, inventory.text as stock_description ' +
      'FROM inventory JOIN stock ' +
      'JOIN ' +

      // Model consumption as a movement from nothing, would be useful to know the difference between moved and consumed
      '(SELECT uuid, depot_entry, depot_exit, tracking_number, quantity, date ' +
      'FROM movement ' +
      'UNION ' +
      'SELECT uuid, null as depot_entry, depot_uuid as depot_exit, tracking_number, quantity, date  ' +
      'FROM consumption ' +
      'UNION ' +
      'SELECT uuid, null as depot_entry, depot_uuid as depot_exit, tracking_number, (quantity * (-1)) AS quantity, date ' +
      'FROM consumption_reversing ) as calculateMovement ON ' +
        'inventory.uuid = stock.inventory_uuid AND stock.tracking_number = calculateMovement.tracking_number ' +
      'WHERE calculateMovement.depot_entry = ' + _depot + ' OR calculateMovement.depot_exit = ' + _depot + ' ' +
      'GROUP BY stock.tracking_number ' +
      'ORDER BY stock.lot_number;';

    return db.exec(sql)
    .then(function (rows) {
      var store = findDrugsInDepot(rows, depot);
      return q(store.data);
    });
  }

  function byAllDrugs (depot) {
    var sql, _depot;

    _depot = sanitize.escape(depot);

    sql =
      'SELECT stock.tracking_number, movement.depot_entry, movement.depot_exit, SUM(stock.quantity) AS quantity, ' +
        'stock.expiration_date, code ' +
      'FROM inventory JOIN stock JOIN movement ON ' +
        'inventory.uuid = stock.inventory_uuid AND stock.tracking_number = movement.tracking_number ' +
      'WHERE (movement.depot_entry = ' + _depot + ' OR movement.depot_exit = ' + _depot + ') ' +
      'GROUP BY inventory.code ' +
      'ORDER BY inventory.code;';

    return db.exec(sql)
    .then(function (rows) {
      var store = findDrugsInDepot(rows, depot);
      return q(store.data);
    });
  }

  return function router (url, depot) {
    var routes, match, defer = q.defer();

    console.log('\n\n Got initial depot router request for', url, depot, '\n\n');
    routes = [
      { re : /lot\/([0-9a-z\-|0-9A-Z\-]+)/ , fn : byLot },
      { re : /drug\/([0-9a-z\-|0-9A-Z\-]+)/, fn : byCode },
      { re : /lots/, fn : byAllLots },
      { re : /drugs/ , fn : byAllDrugs }
    ];

    routes.forEach(function (route) {
      match = route.re.exec(url);
      if (match) { defer.resolve(route.fn(depot, match[1])); }
    });

    if (!match) { defer.reject(new Error('No route found for url : ' + url)); }

    return defer.promise;
  };
};
*/
