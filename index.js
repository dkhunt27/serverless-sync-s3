'use strict';

const BbPromise = require('bluebird');
const AWS = require('aws-sdk');
const path = require("path");
const fs = require('fs');
const chalk = require('chalk');
const https = require('https');
const mime = require('mime-types');

const messagePrefix = 'Serverless: Sync S3: ';

// const walkSync = (currentDirPath, callback) => {
//   fs.readdirSync(currentDirPath).forEach((name) => {
//     const filePath = path.join(currentDirPath, name);
//     const stat = fs.statSync(filePath);
//     if (stat.isFile()) {
//       return callback(filePath, stat);
//     } else if (stat.isDirectory()) {
//       return walkSync(filePath, callback);
//     }
//   });
// };

function walk(dir) {
  return new Promise((resolve, reject) => {
    fs.readdir(dir, (error, files) => {
      if (error) {
        return reject(error);
      }
      Promise.all(files.map((file) => {
        return new Promise((resolve, reject) => {
          const filepath = path.join(dir, file);
          fs.stat(filepath, (error, stats) => {
            if (error) {
              return reject(error);
            }
            if (stats.isDirectory()) {
              walk(filepath).then(resolve);
            } else if (stats.isFile()) {
              resolve(filepath);
            }
          });
        });
      }))
      .then((foldersContents) => {
        resolve(foldersContents.reduce((all, folderContents) => all.concat(folderContents), []));
      });
    });
  });
}

const syncToS3 = ({localDir, bucketName, cli, s3}) => {
  return new Promise((resolve, reject) => {
    return walk(localDir).then(files => {
      const promises = [];
      files.map(file => {
        cli.consoleLog(`${messagePrefix}${chalk.yellow(`Processing file: ${file}`)}`);
        let key = file.replace(localDir+path.sep, '');
        key = key.replace(/\\/g,'/'); // handle windows "/" path separator
        const contentType = mime.contentType(path.extname(file)) ;
        const contentTypeParts = contentType.split(';');
        const params = {
          Bucket: bucketName,
          Key: key,
          Body: fs.readFileSync(file),
          ContentType: contentTypeParts[0]
        };
        promises.push(s3.putObject(params).promise().then(() => {
          cli.consoleLog(`${messagePrefix}${chalk.yellow(`Successfully uploaded ${file} to s3://${bucketName}/${key}`)}`);
        }).catch(err => {
          const errMsg = `error in uploading ${file} to s3 bucket. error: ${err.message}`;
          cli.consoleLog(`${messagePrefix}${chalk.red(errMsg)}`)
          throw new Error(errMsg);
        }));
      });

      return Promise.all(promises).then(() => {
        cli.consoleLog(`${messagePrefix}${chalk.yellow(`Bucket is sync: ${bucketName}`)}`);
        return resolve();
      }).catch(err => {
        cli.consoleLog(`${messagePrefix}${chalk.red(`Error trying to sync the bucket: ${err.message}`)}`);
        return reject(err);
      });

    });
  });
};

const syncAllFolders = ({syncS3, cli, s3}) => {
  return new Promise((resolve, reject) => {
    const promises = [];

    syncS3.map(s => {
      if (!s.bucketName || !s.localDir) {
        return reject(new Error('Invalid custom.syncS3 missing required field(s) (bucketName/localDir)'));
      }
      cli.consoleLog(`${messagePrefix}${chalk.yellow(`Processing bucket/folder ${s.bucketName}/${s.localDir}`)}`);
      promises.push(syncToS3({localDir: s.localDir, bucketName: s.bucketName, cli, s3}));
    });

    return Promise.all(promises).then(() => {
      cli.consoleLog(`${messagePrefix}${chalk.yellow(`Bucket(s) are sync'd`)}`);
      return resolve();
    }).catch(err => {
      cli.consoleLog(`${messagePrefix}${chalk.red(`Error trying to sync the bucket: ${err.message}`)}`);
      return reject(err);
    });
  });
};

const emptyBucket = ({bucketName, cli, s3}) => {
  return new Promise((resolve, reject) => {
    return s3.listObjects({ Bucket: bucketName }).promise().then(list => {
      const params = {
        Bucket: bucketName,
        Delete: {
          Objects: []
        }
      };
      list.Contents.map(item => {
        params.Delete.Objects.push({ Key: item.Key });
      });
      if (params.Delete.Objects.length > 0) {
        return s3.deleteObjects(params).promise();
      } else {
        Promise.resolve('no objects to delete');
      }
    }).then(() => {
      cli.consoleLog(`${messagePrefix}${chalk.yellow(`Emptied bucket: ${bucketName}`)}`);
      return resolve();
    }).catch(err => {
      if (err.message === "The specified bucket does not exist") {
        cli.consoleLog(`${messagePrefix}${chalk.yellow(`Bucket did not exist (thus already empty): ${bucketName}`)}`);
        return resolve();
      } else {
        const errMsg = `error emptying s3 bucket ${bucketName}. error: ${err.message}`;
        cli.consoleLog(`${messagePrefix}${chalk.red(errMsg)}`)
        return reject(new Error(errMsg));
      }
    });
  });
};

const emptyAllBuckets = ({syncS3, cli, s3}) => {
  return new Promise((resolve, reject) => {
    const promises = [];
    syncS3.map(s => {
      if (!s.bucketName || !s.localDir) {
        throw 'Invalid custom.syncS3 missing required field(s) (bucketName/localDir)';
      }
      cli.consoleLog(`${messagePrefix}${chalk.yellow(`Emptying bucket: ${s.bucketName}`)}`);
      promises.push(emptyBucket({bucketName: s.bucketName, cli, s3}));
    });

    return Promise.all(promises).then(() => {
      cli.consoleLog(`${messagePrefix}${chalk.yellow(`Bucket(s) are empty`)}`);
      return resolve();
    }).catch(err => {
      cli.consoleLog(`${messagePrefix}${chalk.red(`Error trying to empty the bucket: ${err.message}`)}`);
      return reject(err);
    });
  });
};

const buildS3Client = ({cli, region, profile, cafile}) => {
  return new Promise((resolve, reject) => {
    cli.consoleLog(`${messagePrefix}${chalk.yellow('buildS3Client: aws sdk config: using region: ' + region)}`);

    const awsConfig = {
      region: region
    };

    if (cafile) {
      cli.consoleLog(`${messagePrefix}${chalk.yellow('buildS3Client: aws sdk config: handling self signed cert: ' + cafile)}`);
      awsConfig.httpOptions = { agent: new https.Agent({ ca: fs.readFileSync(cafile) }) };
    }

    if (profile) {
      cli.consoleLog(`${messagePrefix}${chalk.yellow('buildS3Client: aws sdk config: using profile: ' + profile)}`);
      awsConfig.credentials = new AWS.SharedIniFileCredentials({ profile });
    }

    return resolve(new AWS.S3(awsConfig));
  });
}

class ServerlessSyncS3 {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;

    this.commands = {
      syncS3: {
        usage: 'Helps you start your first Serverless plugin',
        lifecycleEvents: ['sync']
      },
    };

    this.hooks = {
      'after:deploy:deploy': () => BbPromise.bind(this).then(this.sync),
      'before:remove:remove': () => BbPromise.bind(this).then(this.empty),
      'syncS3:sync': () => BbPromise.bind(this).then(this.sync)
    };
  }

  sync() {
    let s3;
    const syncS3 = this.serverless.service.custom.syncS3;
    const cli = this.serverless.cli;
    const region = this.serverless.service.provider.region;
    const profile = this.serverless.service.provider.profile;
    const cafile = this.options.cafile;

    return new Promise((resolve, reject) => {
      cli.consoleLog(`${messagePrefix}${chalk.yellow('sync starting...')}`);

      if (!Array.isArray(syncS3)) {
        cli.consoleLog(`${messagePrefix}${chalk.red('No configuration found')}`)
        return resolve();
      }

      return buildS3Client({cli, region, profile, cafile}).then(result => {

        s3 = result;

        return emptyAllBuckets({cli, s3, syncS3});

      }).then(() => {

        return syncAllFolders({cli, s3, syncS3});

      }).then(() => {

        cli.consoleLog(`${messagePrefix}${chalk.yellow('sync end')}`);
        return resolve();

      }).catch(err => {

        cli.consoleLog(`${messagePrefix}${chalk.red(`sync error: ${err.message}`)}`);
        return reject(err);

      });
    });
  }

  empty() {
    let s3;
    const syncS3 = this.serverless.service.custom.syncS3;
    const cli = this.serverless.cli;
    const region = this.serverless.service.provider.region;
    const profile = this.serverless.service.provider.profile;
    const cafile = this.options.cafile;

    return new Promise((resolve, reject) => {
      cli.consoleLog(`${messagePrefix}${chalk.yellow('remove starting...')}`);

      if (!Array.isArray(syncS3)) {
        cli.consoleLog(`${messagePrefix}${chalk.red('No configuration found')}`)
        return resolve();
      }

      return buildS3Client({cli, region, profile, cafile}).then(result => {

        s3 = result;

        return emptyAllBuckets({cli, s3, syncS3});

      }).then(() => {

        cli.consoleLog(`${messagePrefix}${chalk.yellow('remove end')}`);
        return resolve();

      }).catch(err => {

        cli.consoleLog(`${messagePrefix}${chalk.red(`remove error: ${err.message}`)}`);
        return reject(err);

      });
    });
  }
}

module.exports = ServerlessSyncS3;
