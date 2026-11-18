// @climbio/format 的驗證器：部署時複製進 vendor/（見 firebase.json 的 predeploy），本機直接讀 repo 的 format/
const fs = require('node:fs'), path = require('node:path');
const VENDOR = path.join(__dirname, 'vendor', 'format.js');
module.exports = require(fs.existsSync(VENDOR) ? VENDOR : '../format/format.js');
