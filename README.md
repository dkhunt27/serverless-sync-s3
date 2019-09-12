# Serverless Sync S3 [![npm](https://img.shields.io/npm/v/serverless-sync-s3.svg)](https://www.npmjs.com/package/serverless-sync-s3)

> A plugin to sync local directories and S3 prefixes for Serverless Framework.  Based on the great plugin [serverless-sync-s3](https://github.com/k1LoW/serverless-sync-s3) however, it is using aws-sdk to put the objects into s3 instead of @auth/s3 package.

## Use Case

- Static Website ( `serverless-sync-s3` ) & Contact form backend ( `serverless` ) .
- SPA ( `serverless` ) & assets ( `serverless-sync-s3` ) .

## Install

Run `npm install` in your Serverless project.

```sh
$ npm install --save serverless-sync-s3
```

Add the plugin to your serverless.yml file

```yaml
plugins:
  - serverless-sync-s3
```

## Setup

```yaml
custom:
  syncS3:
    - bucketName: my-static-site-assets
      localDir: dist/assets
    - bucketName: my-other-site
      localDir: path/to/other-site

resources:
  Resources:
    AssetsBucket:
      Type: AWS::S3::Bucket
      Properties:
        BucketName: my-static-site-assets
    OtherSiteBucket:
      Type: AWS::S3::Bucket
      Properties:
        BucketName: my-other-site
        AccessControl: PublicRead
        WebsiteConfiguration:
          IndexDocument: index.html
          ErrorDocument: error.html
```

## Usage

Run `sls deploy`, local directories and S3 prefixes are synced.

Run `sls remove`, S3 objects in S3 prefixes are removed.

### `sls syncS3`

Sync local directories and S3 prefixes.