angular.module('bhima.controllers')
.controller('donation_management', [
  '$scope',
  '$q',
  '$translate',
  '$location',
  '$routeParams',
  'validate',
  'connect',
  'appstate',
  'messenger',
  'precision',
  'store',
  'uuid',
  'util',
  function ($scope,$q,$translate,$location,$routeParams,validate,connect,appstate,messenger,precision,Store,uuid,util) {
    var dependencies = {}, 
        session = $scope.session = {cfg : {}, totals : []}, 
        warnings = $scope.warnings = {};

    if (!angular.isDefined($routeParams.depotId)) {
      messenger.error('NO_DEPOT_ID');
    }

    session.cfg.depot = { id : $routeParams.depotId };

    dependencies.depots = {
      query : {
        identifier : 'uuid',
        tables : {
          'depot' : {
            columns : ['uuid', 'reference', 'text']
          }
        }
      }
    };

    dependencies.inventory = {
      query : {
        identifier : 'uuid',
        tables : {
          inventory : { columns : ['uuid', 'code', 'text', 'purchase_price', 'type_id']}
        }
      }
    };

    dependencies.donor = {
      query : {
        tables : {
          donor : { columns : ['id', 'name']}
        }
      }
    };

    dependencies.employee = {
      query : {
        tables : {
          employee : { columns : ['id', 'code', 'prenom', 'name', 'postnom', 'dob', 'creditor_uuid']}
        }
      }
    };

    dependencies.user = {
      query : 'user_session'
    };

    dependencies.enterprise = {
      query : {
        tables : {
          enterprise : { columns : ['currency_id']}
        }
      }
    };

    appstate.register('project', function (project) {
      $scope.project = project;
      validate.process(dependencies)
      .then(startup)
      .catch(error);
    });

    function startup (models) {
      session.config = {};
      session.config.date = new Date();
      session.donation = {};
      session.donation.items = [];
      $scope.addDonationItem();

      angular.extend($scope, models);
      session.depot = $scope.depots.get($routeParams.depotId);
    }

    function error (err) {
      messenger.danger(JSON.stringify(err));
    }

    // ======================== STEP 1 =============================//
    function DonationItem() {
      var self = this;

      function set(inventoryReference) {
        self.quantity = self.quantity || 1;
        self.code = inventoryReference.code;
        self.text = inventoryReference.text;

        // FIXME naive rounding - ensure all entries/ exits to data are rounded to 4 DP
        self.purchase_price = Number(inventoryReference.purchase_price.toFixed(4));
        self.inventoryId = inventoryReference.uuid;
        self.note = '';
        self.isSet = true;
      }

      this.quantity = 0;
      this.code = null;
      this.inventoryId = null;
      this.purchase_price = null;
      this.text = null;
      this.note = null;
      this.set = set;

      return this;
    }

    $scope.addDonationItem = function() {
      var item = new DonationItem();
      session.donation.items.push(item);
      return item;
    };

    $scope.updateDonationItem = function(donationItem, inventoryReference) {
      if (donationItem.inventoryReference) {
        $scope.inventory.post(donationItem.inventoryReference);
        $scope.inventory.recalculateIndex();
      }
      donationItem.set(inventoryReference);
      donationItem.inventoryReference = inventoryReference;

      // Remove option to select duplicates
      $scope.inventory.remove(inventoryReference.uuid);
      $scope.inventory.recalculateIndex();
    };

    $scope.removeDonationItem = function(index) {
      var currentItem = session.donation.items[index];

      if (currentItem.inventoryReference) {
        $scope.inventory.post(currentItem.inventoryReference);
        $scope.inventory.recalculateIndex();
      }
      session.items.splice(index, 1);
    };

    $scope.donationTotal = function() {
      return session.donation.items.reduce(priceMultiplyQuantity, 0);
    };

    $scope.nextStep = function nextStep() {
      if(session.donation.items.length > 0){
        
        session.donation.items.forEach(function (donation) {
          donation.lots = new Store({ identifier : 'tracking_number', data : [] });
          angular.extend(donation, { isCollapsed : false });
          $scope.addLot(donation);
        });

        calculateTotals();
        // set up watchers for totalling and validation
        var listenCalculateTotals = $scope.$watch('session.donation.items', calculateTotals, true);
        var listenValidateSession = $scope.$watch('session.donation.items', validateSession, true);

        session.donation.step = 'input_inventories';
      }
    };

    $scope.previousStep = function previousStep() {
      session.donation.step = 'select_inventories';
    };

    function priceMultiplyQuantity(a, b) {
      a = (a.quantity * a.purchase_price) || a;
      return (b.code) ? a + (b.quantity * b.purchase_price) : a;
    }

    // ========================== END STEP 1 ===========================//

    // ============================= STEP 2 ===========================//
    function validateSession () {
      session.valid = session.donation.items.every(function (drug) {
        return drug.validLots;
      });
    }

    function Lot () {
      this.inventory_uuid = null;
      this.expiration_date = new Date();
      this.date = new Date();
      this.lot_number = null;
      this.tracking_number = uuid();
      this.quantity = 0;
    }

    $scope.addLot = function addLot (drug) {
      var lot = new Lot();
      lot.code = drug.code;
      lot.inventory_uuid = drug.inventory_uuid;
      drug.lots.post(lot);
    };

    $scope.removeLot = function removeLot (drug, idx) {
      drug.lots.data.splice(idx, 1);
    };

    $scope.expand = function expand (drug) {
      drug.isCollapsed = !drug.isCollapsed;
    };

    function sum (a, b) {
      return a + Number(b.quantity);
    }

    function calculateTotals () {
      if (!session.donation || !session.donation.items) { return; }

      // total and calculate metadata
      var totals = session.totals;

      totals.quantity = 0;
      totals.price = 0;
      totals.purchase_price = 0;
      totals.items = session.donation.items.length;

      session.donation.items.forEach(function (donation) {

        totals.quantity += Math.round(donation.quantity);
        totals.price += Math.round(donation.purchase_price * donation.quantity);

        donation.totalQuantity = donation.lots.data.reduce(sum, 0);
        donation.validLots = donation.totalQuantity == donation.quantity;
      });
    }

    function valid (lots) {
      var isDef = angular.isDefined;
      return lots.data.every(function (row) {
        var n = parseFloat(row.quantity);
        return n > 0 && isDef(row.lot_number) &&
          isDef(row.expiration_date) &&
          !!row.lot_number;
      });
    }

    $scope.cancel = function cancel () {
      session = $scope.session = { cfg : {}, totals : [] };
    };

    $scope.review = function review () {
      // prepare object for cloning
      session.review = true;
      // var lots = [];
      // session.donation.items.forEach(function (o) {
      //   lots = lots.concat(o.lots.data);
      // });
      // session.lots = lots;
    };
    // =========================== END STEP 2 ===========================//

  }
]);