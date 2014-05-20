angular.module('bhima.controllers')
.controller('debitorGroup', [
  '$scope',
  '$q',
  'connect',
  'appstate',
  'messenger',
  'validate',
  'uuid',
  function ($scope, $q, connect, appstate, messenger, validate, uuid) {
    var dependencies = {};
    $scope.data = {};

    dependencies.debitor_group = {
      query : {
        identifier : 'uuid',
        tables : {
          'debitor_group' : {
            columns : ['uuid', 'name', 'account_id', 'location_id', 'payment_id', 'phone', 'email', 'note', 'locked', 'tax_id', 'max_credit', 'is_convention', 'price_list_uuid']
          }
        }
      }
    };

    dependencies.account = {
      required : true,
      query : {
        tables : {
          'account' : {
            columns : ['id', 'account_number', 'account_txt', 'account_type_id']
          }
        }
      }
    };

    dependencies.payment = {
      query : {
        tables : {
          'payment' : {
            columns: ['id', 'text']
          }
        }
      }
    };

    dependencies.price_list = {
      query : {
        tables : {
          'price_list' : {
            columns: ['enterprise_id', 'uuid', 'title', 'description']
          }
        }
      }
    };

    dependencies.location = {
      query : '/location/'
    };


    appstate.register('enterprise', function (enterprise) {
      $scope.enterprise = enterprise;
      dependencies.debitor_group.query.where =
        ['debitor_group.enterprise_id=' + enterprise.id];
      dependencies.price_list.query.where =
        ['price_list.enterprise_id=' + enterprise.id];
      dependencies.account.query.where =
        ['account.locked<>1', 'AND', 'account.enterprise_id=' + enterprise.id];
      validate.process(dependencies).then(setUpModels, handleErrors);
    });

    function handleErrors (err) {
      messenger.danger('Error:' + JSON.stringify(err));
    }

    function setUpModels (models) {
      angular.extend($scope, models);
      $scope.account.data.forEach(function (account) {
        account.account_number = String(account.account_number);
      });
      $scope.action = '';
    }

    $scope.formatAccount = function formatAccount (account) {
      return [account.account_number, account.account_txt].join(' :: ');
    };

    $scope.formatLocation = function formatLocation (location) {
      return [location.village, location.sector, location.province, location.country].join(', ');
    };

    $scope.formatPriceList = function formatPriceList (pl) {
      return pl.title;
    };

    $scope.new = function () {
      $scope.newGroup = {};
      $scope.action = 'new';
    };

    $scope.edit = function (group) {
      $scope.editGroup = angular.copy(group);
      $scope.edit_original = group;
      $scope.action = 'edit';
    };

    $scope.lock = function (group) {
      connect.basicPost('debitor_group', [{uuid: group.uuid, locked: group.locked}], ["uuid"])
      .catch(function (err) {
        messenger.danger('Error : ', JSON.stringify(err));
      });
    };

    $scope.submitNew = function () {
      $scope.newGroup.enterprise_id = $scope.enterprise.id;
      $scope.newGroup.uuid = uuid();
      var data = connect.clean($scope.newGroup);
      connect.basicPut('debitor_group', [data])
      .success(function (res) {
        data.id = res.insertId;
        $scope.debitor_group.post(data);
        $scope.action = '';
      })
      .catch(function (err) {
        messenger.danger('Error :' + JSON.stringify(err));
      });
    };

    $scope.resetNew = function () {
      $scope.newGroup = {};
    };

    $scope.submitEdit =  function () {
      var data = connect.clean($scope.editGroup);
      connect.basicPost('debitor_group', [data], ['uuid'])
      .success(function (res) {
        $scope.debitor_group.put(data);
        $scope.action = '';
        $scope.editGroup = {}; // reset
      })
      .catch(function (err) {
        messenger.danger('Error:' + JSON.stringify(err));
      });
    };

    $scope.resetEdit = function () {
      $scope.editGroup = angular.copy($scope.edit_original);
    };
  }
]);