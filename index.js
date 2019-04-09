const request = require('@zisaid/request');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
let mongo;
let redis;
let dbRes;
let dictPath;
let appKey;
let appAuth;

let wordsDao = {};

wordsDao.init = function (wordDb, dictpath, youdaoAppKdy, youdaoAppAuth, mongoServer, redisServer) {
  mongo = mongoServer;
  redis = redisServer;
  dbRes = wordDb;
  dictPath = dictpath;
  appKey = youdaoAppKdy;
  appAuth = youdaoAppAuth;
};

wordsDao.code2words = function (code) {
  return new Promise((resolve, reject) => {
    mongo.read(dbRes, 'words', {c: code}, 1)
      .then(res => {
        resolve(res);
      })
      .catch(err => {
        reject(err);
      });
  });
};

wordsDao.getWord = function (word) {
  return new Promise(resolve => {
    redis.GET('mongoWords:' + word, -1)
      .then(ref => {
        if (ref) {
          resolve(JSON.parse(ref));
        } else {
          mongo.read(dbRes, 'words', {w: word})
            .then(res => {
              wordsDao.getYoudao(word)
                .then(dict => {
                  if (dict.basic || dict.translation) {
                    let uk = '';
                    if (dict.basic && dict.basic['uk-phonetic']) uk = '[' + dict.basic['uk-phonetic'] + ']';
                    let us = '';
                    if (dict.basic && dict.basic['us-phonetic']) us = '[' + dict.basic['us-phonetic'] + ']';
                    let sy = '';
                    if (dict.basic && dict.basic.explains) sy = dict.basic.explains.join('\n');
                    else if (dict.translation) sy = dict.translation;
                    res.push({w: word, c: [1000001], uk: uk, us: us, sy: sy});
                  }
                  redis.SET('mongoWords:' + word, JSON.stringify(res), redis.XXL);
                  resolve(res);
                });
            });
        }
      });
  });
};

wordsDao.getYoudao = function (word) {
  return new Promise(resolve => {
    let query = word.replace(/[\/\\%]/g, ',');
    fs.readFile(dictPath + '/dict/' + query + '.json', 'utf8', function (err, data) {
      if (!err) {
        resolve(JSON.parse(data));
      } else {
        let salt = Date.now();
        let sign = md5(appKey + query + salt + appAuth);
        let postData = {
          q: query,
          from: 'EN',
          to: 'zh-CHS',
          sign: sign,
          salt: salt,
          appKey: appKey
        };
        request({url: 'https://openapi.youdao.com/api', method: 'post', params: postData})
          .then(oResult => {
            if (oResult.errorCode === '0') {
              delete oResult.tSpeakUrl;
              delete oResult.errorCode;
              delete oResult.dict;
              delete oResult.webdict;
              delete oResult.l;
              delete oResult.speakUrl;
              try {
                delete oResult.basic['uk-speech'];
                delete oResult.basic['us-speech'];
              } catch (e) {
              }
              mkDirs(dictPath + '/dict');
              fs.writeFileSync(dictPath + '/dict/' + query + '.json', JSON.stringify(oResult), 'utf8');
              resolve(oResult);
            } else {
              resolve(null);
            }
          })
          .catch(() => {
            resolve(null);
          });
      }
    });
  });
};

module.exports = wordsDao;

let md5 = function (key) {
  return crypto.createHash('md5').update(key, 'utf-8').digest('hex');
};

let mkDirs = function (dirPath) {
  if (!fs.existsSync(dirPath)) {
    mkDirs(path.dirname(dirPath));
    fs.mkdirSync(dirPath);
  }
};
