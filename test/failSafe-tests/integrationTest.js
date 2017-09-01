var request = require('request');
var async = require('async');
var chai = require('chai');
var expect = chai.expect;
var chalk = require('chalk');
var exec = require('child_process').exec;

const APP_IMAGE_NAME = process.env.APP_IMAGE_NAME;
const  DOMAIN_NAME = process.env.DOMAIN_NAME;
const SERVICE_NAME = APP_IMAGE_NAME + '_web';

var baseurl = 'https://' + APP_IMAGE_NAME + '.' + DOMAIN_NAME + '/api/';

var modelPlural = 'Notes/';
var eventHistoryPlural = 'EventsHistroy/';
var headers = {'tenantId': 'default', 'Accept': 'application/json'};
var eventHistoryRecords;
var results;

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

var token;

describe(chalk.blue('Failsafe - integrationTest'), function () {
  before('login using admin', function fnLogin(done) {
    var loginData = {'username': 'admin', 'password': 'admin'};
    console.log('Base Url is ', baseurl);
    request.post(
      baseurl + 'BaseUsers/login', {
        json: loginData
      },
      function (error, response, body) {
        if (error || body.error) {
          console.log('error:', error || body.error);
          done(error || body.error);
        } else {
          expect(response.statusCode).to.equal(200);
          console.log('success ' + body.id);
          console.log(body);
          token = body.id;
          eventHistoryRecords = {url: baseurl + eventHistoryPlural + '?access_token=' + token, strictSSL: false, json: true, 'headers': headers};
          done();
        }
      });
  });

  var scaleTo = (n, cb) => {
    console.log('scale service web to ' + n);
    exec('docker service scale ' + SERVICE_NAME + '=' + n, (err, stdout) => {
      if (err) console.log('Error in func One: ' + err);
      verifyScale(n, cb);
    });
  };

  var verifyScale = (n, cb) => {
    console.log('verify service count is ', n);
    exec('docker service ps ' + SERVICE_NAME + ' --format "{{json .CurrentState}}" | grep Running | wc -l', (err, stdout) => {
      if (err) {
        console.log('Error in getServiceCount: ' + err);
        setTimeout(verifyScale, 100, n, cb);
      } else {
        var countStatus = parseInt(stdout, 10);
        if (countStatus !== n) {
          console.log('verifyScale - waiting Status: ' + countStatus + ', expected: ' + n);
          setTimeout(verifyScale, 5000, n, cb);
        } else {
          console.log('verifyScale - finished');
          cb();
        }
      }
    });
  };
  var getServiceStatus = (callback) => {
    initResults();
    request.get(eventHistoryRecords, function (error, response, records) {
      if (error) {
        return callback(error);
      }
      expect(response.statusCode).to.equal(200);
      expect(records.length).to.not.equal(0);
      records.forEach((eventHistoryRecord) => {
        results[eventHistoryRecord.status]++;
      }, this);
      if (results.RecoveryFinished < 2) {
        setTimeout(getServiceStatus, 1000, callback);
      } else {
        return callback();
      }
    });
  };

  var initResults = () => {
    results = {};
    results.undefined = 0;
    results.RecoveryFinished = 0;
    results.ToBeRecovered = 0;
    results.InRecovery = 0;
  };

  it('Recover - Default sceanrio', function (done) {
    async.series({
      clearHistory: (callback) => {
        console.log('At clear history');
        console.log('url: ' + eventHistoryRecords.url);
        request.get(eventHistoryRecords, function (error, response, body) {
          if (error) console.log('error in fetching event-history records:', error || body.error);
          console.log('Recived event history records');
          console.log(body);
          var eventHistoryRecords = body;
          async.each(eventHistoryRecords, (eventHistoryRecord, cb) => {
            console.log('Trying to delete ' + eventHistoryRecord.id);
            request.delete(
              baseurl + eventHistoryPlural + eventHistoryRecord.id + '?access_token=' + token,
              function (error, response, body) {
                if (error || body.error) {
                  console.log('error in deleting event-history record:', error || body.error);
                  return cb(error);
                }
                console.log('Delete success' );
                return cb();
              }
            );
          }, (err)=> {
            if (err) {
              return callback(err);
            }
            callback();
          });
        });
      },
      scaleServiceTo5: (callback) => {
        scaleTo(5, callback);
      },
      initiateNodes: (callback) => {
        console.log('create 50 note records');
        var createUrl = baseurl + modelPlural + '?access_token=' + token;
        console.log('posting to note: ', createUrl);
        async.times(100, (i, next) => {
          request.post({url: createUrl, json: {}, headers: headers, method: 'POST'}, function (error, r, body) {
            expect(r.statusCode).to.equal(200);
            return next(null, body.id);
          });
        }, (err, results) => {
          if (err) {
            return done(err);
          }
          return callback();
        });
      },
      scaleServiceCountDown: (callback) => {
        scaleTo(3, callback);
      },
      getServiceStatus: getServiceStatus
    }, (err) => {
      if (err) {
        return done(err);
      }
      console.log(results);
      if (results.RecoveryFinished === 2 ) {
        return done();
      }
      return done(new Error('Not All dead hosts were recoverd'));
    });
  });
});