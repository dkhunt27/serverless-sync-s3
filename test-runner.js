const ServerlessSyncS3 = require("./index");
const syncS3 = new ServerlessSyncS3({
    cli: {
        consoleLog: console.log
      },
  service: {
    provider: {
      profile: "",
      region: "us-east-2"
    },
    custom: {
      syncS3: [{
        bucketName: "delete-me-serverless-sync-s3-test-bucket",
        localDir: "dist"
      }]
    }
  }
}, {
    cafile: ""
});

console.log(syncS3.sync());
