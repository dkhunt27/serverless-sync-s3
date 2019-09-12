'use strict';

const BbPromise = require('bluebird');
const AWS = require('aws-sdk');
const path = require("path");
const fs = require('fs');
const chalk = require('chalk');
const https = require('https');
const mime = require('mime-types');

const messagePrefix = 'Serverless: Sync S3: ';

const walkSync = (currentDirPath, callback) => {
  fs.readdirSync(currentDirPath).forEach((name) => {
    const filePath = path.join(currentDirPath, name);
    const stat = fs.statSync(filePath);
    if (stat.isFile()) {
      return callback(filePath, stat);
    } else if (stat.isDirectory()) {
      return walkSync(filePath, callback);
    }
  });
};

const syncToS3 = (localDir, s3BucketName, cli, s3) => {
  return walkSync(localDir, async (filePath) => {
    cli.consoleLog(`${messagePrefix}${chalk.yellow(`Processing file: ${filePath}`)}`);
    const key = filePath.replace(localDir+'/', '');
    const contentType = mime.contentType(path.extname(filePath)) ;
    const contentTypeParts = contentType.split(';');
    const params = {
      Bucket: s3BucketName,
      Key: key,
      Body: fs.readFileSync(filePath),
      ContentType: contentTypeParts[0]
    };
    try {
      await s3.putObject(params).promise();
      cli.consoleLog(`${messagePrefix}${chalk.yellow(`Successfully uploaded ${filePath} to s3://${s3BucketName}/${key}`)}`);
    } catch (error) {
      const errMsg = `error in uploading ${filePath} to s3 bucket. error: ${error.message}`;
      cli.consoleLog(`${messagePrefix}${chalk.red(errMsg)}`)
      throw new Error(errMsg);
    }
  });
};

const emptyBucket = (bucketName, cli, s3) => {
  return new Promise((resolve, reject) => {
    s3.listObjects({ Bucket: bucketName }).promise().then(list => {
      const params = {
        Bucket: bucketName,
        Delete: {
          Objects: []
        }
      };
      list.Contents.map(item => {
        params.Delete.Objects.push({ Key: item.Key });
      });
      return s3.deleteObjects(params).promise();
    }).then((res) => {
      cli.consoleLog(`${messagePrefix}${chalk.yellow(`Emptied bucket: ${bucketName}`)}`);
      return resolve();
    }).catch(err => {
      const errMsg = `error emptying s3 bucket ${bucketName}. error: ${err.message}`;
      cli.consoleLog(`${messagePrefix}${chalk.red(errMsg)}`)
      return reject(new Error(errMsg));
    });
  });
};

const buildS3Client = ({cli, region, profile, cafile}) => {
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

  return new AWS.S3(awsConfig);
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
      'before:syncS3:sync': () => BbPromise.bind(this).then(this.beforeSync),
      'syncS3:sync': () => BbPromise.bind(this).then(this.sync),
      'after:syncS3:sync': () => BbPromise.bind(this).then(this.afterSync),
    };
  }

  beforeSync() {
    this.serverless.cli.consoleLog(`${messagePrefix}${chalk.yellow('syncS3 starting...')}`);
  }

  sync() {
    return new Promise((resolve, reject) => {
      const syncS3 = this.serverless.service.custom.syncS3;
      const region = this.serverless.service.provider.region;
      const profile = this.serverless.service.provider.profile;
      const cafile = this.options.cafile;
      const cli = this.serverless.cli;

      if (!Array.isArray(syncS3)) {
        cli.consoleLog(`${messagePrefix}${chalk.red('No configuration found')}`)
        return resolve();
      }

      const s3 = buildS3Client({cli, region, profile, cafile});

      syncS3.map(s => {
        if (!s.bucketName || !s.localDir) {
          return reject(new Error('Invalid custom.syncS3 missing required field(s) (bucketName/localDir)'));
        }
        this.serverless.cli.consoleLog(`${messagePrefix}${chalk.yellow(`Processing bucket/folder ${s.bucketName}/${s.localDir}`)}`);
        return syncToS3(s.localDir, s.bucketName, cli, s3);
      });

      return resolve();
    });
  }

  empty() {
    return new Promise((resolve, reject) => {
      const syncS3 = this.serverless.service.custom.syncS3;
      const region = this.serverless.service.provider.region;
      const profile = this.serverless.service.provider.profile;
      const cafile = this.options.cafile;
      const cli = this.serverless.cli;

      if (!Array.isArray(syncS3)) {
        cli.consoleLog(`${messagePrefix}${chalk.red('No configuration found')}`)
        return resolve();
      }

      const s3 = buildS3Client({cli, region, profile, cafile});

      const promises = [];
      syncS3.map(s => {
        if (!s.bucketName || !s.localDir) {
          throw 'Invalid custom.syncS3 missing required field(s) (bucketName/localDir)';
        }
        cli.consoleLog(`${messagePrefix}${chalk.yellow(`Emptying bucket: ${s.bucketName}`)}`);
        promises.push(emptyBucket(s.bucketName, cli, s3));
      });

      Promise.all(promises).then(() => {
        cli.consoleLog(`${messagePrefix}${chalk.yellow(`Bucket(s) are empty`)}`);
        return resolve();
      }).catch(err => {
        cli.consoleLog(`${messagePrefix}${chalk.red(`Error trying to empty the bucket: ${err.message}`)}`);
        return reject(err);
      });
    });
  }

  afterSync() {
    this.serverless.cli.consoleLog(`${messagePrefix}${chalk.yellow('syncS3 end')}`);
  }
}

module.exports = ServerlessSyncS3;
