'use strict';

var gitty       = require('gitty');
var Promise     = require('bluebird');
var GithubAPI   = require('github');
var editor      = require('editor');
var extend      = require('extend');
var temp        = require('temp');
var fs          = require('fs');
var path        = require('path');
var tpAPI       = require('tp-api');
var logger      = require('./lib/logging').logger();
var revalidator = require('revalidator');

var github, targetprocess;

var Repository = Repository;
function Repository () {
  this.config = {};
  this.config.remote = 'origin';
}

Repository.prototype.setup = function () {
  var promise = Promise.all([
    getCurrentBranchName(),
    getRepoOwner(),
    getRepoName()
  ])
  .bind(this)
  .then(function (args) {
    this.config.currentBranchName = args[0];
    this.config.ownerName         = args[1];
    this.config.name              = args[2];

    return this;
  });

  return promise;
};

Repository.prototype.push = function () {
  var repo                = repository();
  var currentBranchName   = this.config.currentBranchName;
  var remote              = this.config.remote;

  if ( currentBranchName === 'master') {
    logger.error('Not pushing master');
    return;
  }

  return Promise.promisify(repo.push)(remote, currentBranchName, {})
  .bind(this)
  .then(function () {
    logger.info('Pushed branch', currentBranchName);
    return this;
  });
};

var PullRequest = PullRequest;
function PullRequest (options) {
  this.options = options;
}

PullRequest.prototype.setupRepo = function (repo) {
  this.repo = repo;
};

PullRequest.prototype.create = function (options) {
  var data = {
    user: this.repo.config.ownerName,
    title: options.title,
    body: options.body,
    repo: this.repo.config.name,
    base: this.options.base,
    head: this.repo.config.currentBranchName
  };

  return Promise.promisify(github.pullRequests.create)(data)
  .bind(this)
  .then( function (data) {
    logger.info('created PR #', data.number);
    this.url    = data.url;
    this.number = data.number;
  });
};

PullRequest.prototype.assign = function () {
  var data;

  if (!this.options.assignee) {
    return Promise.resolve(this);
  }

  data = extend(this._buildDefaultOptions(), {
    number   : this.number,
    assignee : this.options.assignee
  });

  return Promise.promisify(github.issues.edit)(data)
  .bind(this)
  .then( function () {
    logger.info('assigned PR to', data.assignee);
    return this;
  });
};

PullRequest.prototype._buildDefaultOptions = function () {
  return {
    user: this.repo.config.ownerName,
    repo: this.repo.config.name,
    head: this.repo.config.currentBranchName
  };
};

module.exports = run;
function run (config, options) {
  var prOptions = {
    base     : options.base || 'master',
    assignee : options.assignee
  };

  var validationResult = revalidator.validate(config, {
    properties: {
      credentials : {
        type: 'object',
        required: true,
        properties : {
          github: {
            type: 'object',
            require: true,
            properties: {
              type: {
                type: 'string',
                required: true
              },
              token : {
                type: 'string',
                required: true
              }
            }
          },
          targetprocess: {
            type: 'object',
            required: 'true',
            properties: {
              domain: {
                type: 'string',
                required: true
              },
              username: {
                type: 'string',
                required: true
              },
              password: {
                type: 'string',
                required: true
              }
            }
          }
        }
      }
    }
  });

  if (!validationResult.valid) {
    logger.error('Some of the configuration parameters are invalid');
    return;
  }

  github = new GithubAPI({ version: '3.0.0' });
  github.authenticate(config.credentials.github);

  targetprocess = tpAPI(config.credentials.targetprocess);

  var pr   = new PullRequest(prOptions);
  var repo = new Repository();

  repo
  .setup()
  .bind(repo)
  .then(repo.push)
  .bind(pr)
  .then(pr.setupRepo)
  .then(prMessage(options.template, options['tp-id']))
  .then(pr.create)
  .then(pr.assign)
  .then(function (pr) {
    if (!options['tp-id']) {
      return;
    }

    var comment = 'Created Pull Request ' + pr.url;
    targetprocess().comment(options['tp-id'], comment, function (error) {
      if (error) {
        logger.log(error);
      }
    });
  });
}

function prMessage (template, tpTicket) {
  temp.track();

  return function () {
    return new Promise( function (resolve) {
      fs.readFile(path.resolve(template), function (err, templateData) {
        temp.open(null, function (err, info) {
          var templateString = templateData.toString();
          var message        = templateString.replace(/:tp-ticket-id:/g, tpTicket);

          var data = [
            '\n',
            message
          ];

          fs.writeFile(info.path, data.join(''), function () {
            editor(info.path, function () {
              fs.readFile(info.path, function (error, data) {
                var message = data.toString();
                var lines   = message.split('\n');
                var title   = lines[0];
                var body    = lines.slice(1, lines.length - 1).join('\n');

                resolve({title: title, body: body});
              });
            });
          });
        });
      });
    });
  };
}

function repository () {
  var repoPath = process.cwd();
  var repo = gitty(repoPath);

  return repo;
}

function getRemote () {
  var repo = repository();

  return Promise.promisify(repo.getRemotes, repo)();
}

function getBranches () {
  var repo = repository();

  return Promise.promisify(repo.getBranches, repo)();
}

function getCurrentBranchName () {
  return getBranches()
  .then(function (branches) {
    return branches.current;
  });
}

function getRepoName () {
  return getRemote()
  .then(getRepoNameFromRemote);
}

function getRepoOwner () {
  return getRemote()
  .then(getRepoOwnerFromRemote);
}

function getRepoNameFromRemote (remote) {
  var remoteName = remote.origin.match(/\/([\w-]+)\.git$/)[1];
  return remoteName;
}

function getRepoOwnerFromRemote (remote) {
  var repoOwner = remote.origin.match(/\:([\w-]+)\/.+$/)[1];
  return repoOwner;
}