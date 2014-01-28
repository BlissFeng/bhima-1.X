// Services.js
//TODO: Define API for getting data from the server - providing query data, simple table names, etc.

(function (angular) {
  'use strict';
  
  var services = angular.module('kpk.services', []);
    
  services.service('kpkUtilitaire', function() { 

    this.formatDate = function(dateString) {
      return new Date(dateString).toDateString();
    };

    Date.prototype.toMySqlDate = function (dateParam) {
      var date = new Date(dateParam), annee, mois, jour;
      annee = String(date.getFullYear());
      mois = String(date.getMonth() + 1);
      if (mois.length === 1) {
       mois = "0" + mois;
      }
      jour = String(date.getDate());
        if (jour.length === 1) {
          jour = "0" + jour;
      }      
      return annee + "-" + mois + "-" + jour;
    };

    this.convertToMysqlDate = function(dateString) {
      return new Date().toMySqlDate(dateString);
    };



    this.isDateAfter = function(date1, date2){
      date1 = new Date(date1).setHours(0,0,0,0);
      date2 = new Date(date2).setHours(0,0,0,0);
      return date1 > date2;
    };

    this.areDatesEqual = function(date1, date2){
      date1 = new Date(date1).setHours(0,0,0,0);
      date2 = new Date(date2).setHours(0,0,0,0);
      return date1 === date2;
    };
  });
  
  services.factory('validate', function($q, connect) {  
    var modelLabel = 'model';

    //TODO Exception handling
    function process(dependencies, limit) {   
      var deferred = $q.defer();
      var list = filterList(dependencies, (limit || Object.keys(dependencies)));
      
      dependencies[modelLabel] = dependencies[modelLabel] || {};
      fetchModels(dependencies, list).then(function(res) { 
        
        //Package models 
        list.forEach(function(key, index) { 
          dependencies.model[key] = res[index];
          dependencies[key].processed = true; 
        });

        //Test models
        
        deferred.resolve(dependencies.model);
      }, function(err) { 
        deferred.reject(err);   
      });
      return deferred.promise;
    }

    function filterList(dependencies, list) { 
      var filterList;
      filterList = list.filter(function(key, index) {
        
        //filter process requests
        if(dependencies[key].processed) return false;
        
        //filter model store
        if(key===modelLabel) return false;
        return true;
      });
      return filterList;
    }

    function fetchModels(dependencies, keys) { 
      var deferred = $q.defer(), promiseList = [];
      
      //Requests
      keys.forEach(function(key) { 
        var dependency = dependencies[key], args = [dependency.query];
        
        //Hack to allow modelling reports with unique identifier - not properly supported by connect
        if(dependency.identifier) args.push(dependency.identifier);
        promiseList.push(connect.req.apply(connect.req, args));
      });
      
      //Response
      $q.all(promiseList).then(function(res) { 
        deferred.resolve(res); 
      }, function(err) { 
        deferred.reject(err);  
      });
      return deferred.promise;
    } 

    function validate() { 
      //remove startup tests to only serve model validation
      runStartupTests();
    }
    
    //TODO This should be in the dependency object passed in to process()
    function registerRequirements(requirements) { 
      var response = {};

      //FIXME requirements validation 
      requirements.forEach(function(item, index) { 
        if(testSuite[item]) { 
          
          //if testSuite[item] isn't completed, queue until everything is ready
          response[item] = testSuite[item].result;
        } else { 
          response[item] = null;
        } 
      });
    }
  
    //FIXME rewrite this method
    function processModels(models) { 
      //TODO tests should be a list of 
      //[{test: function(), message: ""}]
      var deferred = $q.defer(), pass = true; 
      /*
       * dependencies
       * {
       *  query : { tables...}
       *  test : function(return true or false);
       *  required: true || false
       *
      */

      angular.forEach(models, function(dependency, key) { 
        var required = dependency.required || false, data = dependency.model.data;
        var tests = dependency.test || [];
        
        //run default required test
        if(required) {
          pass = isNotEmpty(data);
          if(!pass) {  
            deferred.resolve({passed: false, message: 'Required table ' + key + ' has no data'});
            return false; //break from loop 
          }
        }
      
        //if required fails loop will return before this point 
        //TODO tests can currently only be syncronous
        tests.forEach(function(test) { 
          var testResult = test();
          if(!testResult) { 
            pass = testResult;
            return false; //break from loop
          }
        });
      }); 

      deferred.resolve({passed: pass, message: 'End of process'}); 
      return deferred.promise;
    }

    //private methods  
    //TODO Either the service should define, run and store test results to be accessed from units, or the tests should be defined elsewhere i.e application.js
    function runStartupTests() { 
      angular.forEach(testSuite, function(test, key) { 
        var args = test.args || [];

        test.method(args).then(function(res) {
          test.result = res;
        });
      });
    }

    var testSuite = { 
      "enterprise" : {method: testRequiredModel, args: ["enterprise"], result: null},
      "fiscal" : {method: testRequiredModel, args: ["fiscal_year"], result: null}
    };
    
    function testRequiredModel(tableName, primaryKey) { 
      var deferred = $q.defer();
      var testDataQuery = { 
        tables : {}
      };

      primaryKey = (primaryKey || "id"); 
      testDataQuery.tables[tableName] = { 
        columns: [primaryKey]
      };

      //download data to test 
      connect.req(testDataQuery)
      .then(function(res) { 
        
        //run test on data
        deferred.resolve(isNotEmpty(res.data));
      }, function(err) { 
        
        //download failed
        deferred.reject();
      });
      return deferred.promise;
    }
       
    //utility methods
    function isNotEmpty(data) { 
      if(data.length > 0) return true;
      return false;
    }

    validate();
   
    //TODO horrible name
    function valid() { 
      return { 
        processModels : processModels,
        process : process
      };
    }
    return new valid;
  });

  services.factory('appcache', function ($rootScope, $q) { 
    var DB_NAME = "kpk", VERSION = 21;
    var db, cacheSupported, dbdefer = $q.defer();

    function cacheInstance(namespace) { 
      if(!namespace) throw new Error('Cannot register cache instance without namespace');
      return { 
        namespace: namespace,
        fetch: fetch,
        fetchAll: fetchAll,
        put: put
      }
    }

    function init() { 
      //also sets db - working on making it read better
      openDBConnection(DB_NAME, VERSION)
      .then(function(connectionSuccess) { 
        dbdefer.resolve();
      }, function(error) { 
        throw new Error(error);
      });
    }

    //generic request method allow all calls to be queued if the database is not initialised
    function request(method) { 
      console.log(method, arguments);
      if(!requestMap[method]) return false;
      requestMap[method](value);
    }

    //TODO This isn't readable, try common request (queue) method with accessor methods
    function fetch(key) {
      var t = this, namespace = t.namespace;
      var deferred = $q.defer();
      dbdefer.promise
      .then(function() { 
        //fetch logic
        var transaction = db.transaction(['master'], "readwrite");
        var objectStore = transaction.objectStore('master');
        var request = objectStore.index('namespace, key').get([namespace, key]);
        
        request.onsuccess = function(event) { 
          var result = event.target.result;
          $rootScope.$apply(deferred.resolve(result));
        };
        request.onerror = function(event) { 
          $rootScope.$apply(deferred.reject(event)); 
        };
      }); 
      return deferred.promise;
    }
  
    function put(key, value) { 
      var t = this, namespace = t.namespace;
      var deferred = $q.defer();
      
      dbdefer.promise
      .then(function() { 
        var writeObject = { 
          namespace: namespace,
          key: key
        }
        var transaction = db.transaction(['master'], "readwrite");
        var objectStore = transaction.objectStore('master');
        var request;
       
        //TODO jQuery dependency - write simple utility to flatten/ merge object
        writeObject = jQuery.extend(writeObject, value);
        request = objectStore.put(writeObject); 

        request.onsuccess = function(event) { 
          deferred.resolve(event);
        }
        request.onerror = function(event) { 
          deferred.reject(event);
        }
      }); 
      return deferred.promise;
    }

    function fetchAll() { 
      var t = this, namespace = t.namespace;
      var deferred = $q.defer();

      dbdefer.promise
      .then(function() {
        var store = [];
        var transaction = db.transaction(['master'], 'readwrite');
        var objectStore = transaction.objectStore('master');
        var request = objectStore.index('namespace').openCursor(namespace);

        request.onsuccess = function(event) {
          var cursor = event.target.result;
          if(cursor) { 
            store.push(cursor.value);
            cursor.continue();
          } else {
            $rootScope.$apply(deferred.resolve(store));
          }
        }

        request.onerror = function(event) { 
          deferred.reject(event);
        }
      });
      return deferred.promise;
    }

    function openDBConnection(dbname, dbversion) { 
      var deferred = $q.defer();
      var request = indexedDB.open(dbname, dbversion);
      request.onupgradeneeded = function(event) { 
        db = event.target.result;
        //TODO naive implementation - one object store to contain all cached data, namespaced with feild
        //TODO possible implementation - create new object store for every module, maintain list of registered modules in master table
       
        //delete object store if it exists - DEVELOPMENT ONLY
        if(db.objectStoreNames.contains('master')) {
          //FIXME no error/ success handling
          db.deleteObjectStore('master');  
        }
        var objectStore = db.createObjectStore("master", {keyPath: ['namespace', 'key']});
        objectStore.createIndex("namespace, key", ["namespace", "key"], {unique: true}); 
        objectStore.createIndex("namespace", "namespace", {unique: false});
        objectStore.createIndex("key", "key", {unique: false});
      };

      request.onsuccess = function(event) {
        db = request.result;
        $rootScope.$apply(deferred.resolve());
      };
      request.onerror = function(event) { 
        deferred.reject(event);
      };
      return deferred.promise;
    }

    cacheSupported = ("indexedDB" in window);
    if(cacheSupported) { 
      init();
    } else { 
      console.log('application cache is not supported in this context');
    }
    return cacheInstance;
  });

  services.factory('appstate', function ($q, $rootScope) { 
    //TODO Use promise structure over callbacks, used throughout the application and enables error handling 
    var store = {}, queue = {};

    function set(storeKey, value) { 
      store[storeKey] = value;
      executeQueue(storeKey);
    }

    function get(storeKey) { 
      return store[storeKey];
    }

    function register(storeKey, callback) { 
      var requestedValue = store[storeKey];
      var queueReference = queue[storeKey] = queue[storeKey] || [];

      if(requestedValue) { 
        callback(requestedValue);
        return;
      }  
      queueReference.push({callback: callback});
    }

    function executeQueue(storeKey) { 
      var queueReference = queue[storeKey];
      if(queueReference) { 
        queueReference.forEach(function(pendingRequest) { 
          pendingRequest.callback(store[storeKey]);
        });
      }
    }

    return {
      get : get,
      set : set,
      register : register
    };
  });

  services.factory('store', function () {
    // store service 
    
    return function (options, target) {
      
      // the data store, similar to Dojo's Memory Store.
      options = options || {};
      // globals
      this.index = {};
      this.data = {};

      // locals
      var queue = [];
      var identifier = options.identifier || 'id'; // id property
      var pprint = '[connect] ';
      var refreshrate = options.refreshrate || 500;

      // set an array of data
      this.setData = function (data) {
        var index = this.index = {};
        this.data = data;

        for (var i = 0, l = data.length; i < l; i++) {
          index[data[i][identifier]] = i;
        }
      };

      // constructor function
      var self = this;
      (function contructor () {
        for (var k in options) {
          self[k] = options[k]; 
        }
        // set data if it is defined
        if (options.data) self.setData(options.data);
        // set up refreshrate
      })();

      // get an item from the local store
      this.get = function (id) {
        return this.data[this.index[id]];
      };

      // put is for UPDATES 
      this.put = function (object, opts) {        
        var data = this.data,
            index = this.index,
            id = object[identifier] = (opts && "id" in opts) ? opts.id : identifier in object ?  object[identifier] : false;

        if (!id) throw pprint + 'No id property in the object.  Expected property: ' + identifier;  

        // merge or overwrite
        if (opts && opts.overwrite) {
          data[index[id]] = object; // overwrite
        } else {
          var ref = data[index[id]];
          if(!ref) ref = {};
          for (var k in object) {
            ref[k] = object[k]; // merge
          }
        }
        // enqueue item for sync
        queue.push({method: 'PUT', url: '/data/'+ target});
      };

      // post is for INSERTS
      this.post = function (object, opts) {

        var data = this.data,
            index = this.index,
            id = object[identifier] = (opts && "id" in opts) ? opts.id : identifier in object ?  object[identifier] : Math.random();
        if (id in index) throw pprint + 'Attempted to overwrite data with id: ' + id + '.';
        index[id] = data.push(object) - 1;
        // enqueue item for sync
        queue.push({method: 'POST', url: '/data/' + target, data: object});
      };

      this.remove = function (id) {
        var data = this.data,
            index = this.index;
        
        if (id in index) {
          console.log("Trying to split on ",data);
          data.splice(index[id], 1);
          this.setData(data);
          queue.push({method: 'DELETE', url: '/data/' + target + '/' + id});
        }
      };

      this.generateid = function () {
        // generate a new id by incrimenting the last id
        // in the store
        var id = Math.max.apply(Math.max, Object.keys(this.index)) + 1;
        return (id > 0)  ? id : 1;
      };

      this.contains = function (id) {
        // check to see if an object with
        // this id exists in the store.
        return !!this.get(id);
      };

      this.sync = function () {
        // sync the data from the client to the server
        var fail = [];
        queue.forEach(function (req) {
          console.log(pprint, 'Executing: ', req);
          $http(req)
            .success(function () {
              console.log(req.data.id, "synced successfully."); 
            }) 
            .error(function (data, status, headers, config) {
              alert("An error in data transferred occured with status:", status); 
              fail.push(req);
            });
        });
        queue = fail;
      };

      this.recalculateIndex = function () { 
        var data = this.data, index = this.index;
        for (var i = 0, l = data.length; i < l; i++) {
          index[data[i][identifier]] = i;
        }
      };

      return this;
    };
  });

  services.factory('connect', function ($http, $q, store) {
    //summary: 
    //  provides an interface between angular modules (controllers) and a HTTP server. Requests are fetched, packaged and returned
    //  as 'models', objects with indexed data, get, delete, update and create functions, and access to the services scope to 
    //  update the server.

    //  TODO generic id property should be injected, currently set as ID
    //  TODO set flag for automatically flushing model updates to server
    //  TODO anonymous functions make for bad stack traces - name those bad boys

    //keep track of requests, model can use connect API without re-stating request
    //  model : request
    var requests = {};
  
    //FIXME remove identifier without breaking functionality (passing direct strings to req)
    function req (defn, stringIdentifier) {
      //summary: 
      //  Attempt at a more more managable API for modules requesting tables from the server, implementation finalized
      //
      //  defn should be an object like
      //  defn =  {
      //    tables : {
      //      'account' : {
      //        columns: [ 'enterprise_id', 'id', 'locked', 'account_text']
      //      },
      //      'account_type' : {
      //        columns: ['type']
      //      }
      //    },
      //    join: ['account.account_type_id=account_type.id'],
      //    where: ['account.enterprise_id=101']
      //  };
      //
      //  where conditions can also be specified:
      //    where: ['account.enterprise_id=101', 'AND', ['account.id<100', 'OR', 'account.id>110']]
      if (angular.isString(defn)) {
        // CLEAN THIS UP
        var d = $q.defer();
        $http.get(defn).then(function (returned) {
          returned.identifier = stringIdentifier || 'id';
          d.resolve(new store(returned));
        }, function (err) {
          throw err; // temporary
        });
        return d.promise;
      }

      var handle, deferred = $q.defer();
      var table = defn.primary || Object.keys(defn.tables)[0];


      handle = $http.get('/data/?' + JSON.stringify(defn));
      handle.then(function (returned) {
        
        //massive hack so I can use an identifier - set defualt identifier
        returned.identifier = defn.identifier || 'id';
        var m = new store(returned, table);
        requests[m] = defn;
        deferred.resolve(m);
      }, function(err) { 
        //package error object with request parameters for error routing
        deferred.reject(packageError(err, table));
      });

      return deferred.promise;
    }

    function getModel(getRequest, identifier) { 
      //TODO Decide on API to handle packing direct GET requests in model 
      var handle, deferred = $q.defer();
      handle = $http.get(getRequest);
      handle.then(function(res) {
        res.identifier = identifier || 'id';
        var m = new store(res, getRequest);
        deferred.resolve(m);
      });
      return deferred.promise;
    }

    function fetch (defn) {
      //summary: 
      //  Exactly the same as req() but now returns only
      //  data.  Think of it as a `readonly` store.
      var handle, deferred = $q.defer();

      if (angular.isString(defn)) return $http.get(defn);

      handle = $http.get('/data/?' + JSON.stringify(defn));
      handle.then(function (returned) {
        deferred.resolve(returned.data);
      });
      return deferred.promise;
    }

    function debitorAgingPeriod(){
      var handle, deferred = $q.defer();
      handle = $http.get('debitorAgingPeriod/');
      handle.then(function(res) { 
        deferred.resolve(res);
      });
      return deferred.promise;
    }


    function journal (invoice_ids) {
      return $http.post('/journal/', invoice_ids);
    }

    function basicGet(url) {
      return $http.get(url);
    }

    function MyBasicGet(target){
      var promise = $http.get(target).then(function(result) { 
        return result.data;
      });
      return promise;
    }

    function basicDelete (table, id, column) {
      if (!column) column = "id";
      return $http.delete(['/data/', table, '/', column, '/', id].join(''));
    }

//    TODO reverse these two methods? I have no idea how this happened
    function basicPut(table, object) {
      var format_object = {t: table, data: object};
      return $http.post('data/', format_object);
    }

    function basicPost(table, object, primary) {
      var format_object = {t: table, data: object, pk: primary};
      return $http.put('data/', format_object);
    }

    function clean (obj) {
      // clean off the $$hashKey and other angular bits and delete undefined
      var cleaned = {};
      for (var k in obj) {
        if (k != '$$hashKey' && angular.isDefined(obj[k]) && obj[k] !== "" && obj[k] !== null) cleaned[k] = obj[k];
      } 
      return cleaned;
    }

    function packageError(err, table) { 
      //I'm sure this is literally gross, should do reading up on this
      err.http = true;
      err.table = table || null;
      return err;
    }

    return {
      req: req,
      basicPut: basicPut,
      basicPost: basicPost,
      basicGet: basicGet,
      basicDelete: basicDelete,
      getModel: getModel,
      journal: journal,
      fetch: fetch,
      clean: clean,
      MyBasicGet: MyBasicGet,
      debitorAgingPeriod : debitorAgingPeriod
    };
  });


  services.service('messenger', function ($timeout, $sce) {
    var self = this;
    self.messages = [];
    var indicies = {};

    self.push = function (data, timer) {
      var id = Date.now();
      data.id = id;
      data.msg = $sce.trustAsHtml(data.msg); // allow html insertion
      self.messages.push(data); 
      indicies[id] = $timeout(function () {
        var index, i = self.messages.length;

        while (i--) { if (self.messages[i].id === id) { self.messages.splice(i, 1); break; } }

      }, timer || 3000);
    };

    (function () {
      ['info', 'warning', 'danger', 'success']
      .forEach(function (type) {
        self[type] = function (message, timer) {
          self.push({type: type, msg: message }, timer);
        };
      });
    })();

    self.close = function (idx) {
      // cancel timeout and splice out
      $timeout.cancel(indicies[idx]);
      self.messages.splice(idx, 1);
    };

  });

  services.factory('exchange', function (connect, appstate, $timeout) {
    var enterprise, rateMap;

    appstate.register('enterprise', function (e) {
      enterprise = e;
      refresh();
    });

    function refresh () {
      rateMap = null;
      var date = new Date().toISOString().slice(0,10);
      connect.fetch({
        tables : { 'exchange_rate' : { columns : ['id', 'enterprise_currency_id', 'foreign_currency_id', 'rate', 'date'] }},
        where : ['exchange_rate.date='+date]
      }).then(function (array) {
        $timeout(function () {
          rateMap = {};
          // This does two loops, but I feel it is not bad
        
          array.forEach(function (rate) {
            rateMap[rate.foreign_currency_id] = rate.rate;
          });
        });

      });
    }

    return function exchange (value, to) {
      // value is a number
      // to is a currency_id
      // from is a currency_id
      return rateMap ? (rateMap[to] || 1)* value : value;
    };
  });

})(angular);
