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

let dict = {};

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

wordsDao.getTts = function (query) {
  query = query.replace(/[\/\\%]/g, ',');
  return new Promise((resolve, reject) => {
    let path = dictPath + '/wyaudio/youdao/';
    let audio = '';
    if (fs.existsSync(path + query + '.mp3')) {
      audio = path + query + '.mp3';
    } else if (fs.existsSync(path + query.toLocaleLowerCase() + '.mp3')) {
      audio = path + query.toLocaleLowerCase() + '.mp3';
    }
    if (audio) {
      //文件里有
      fs.readFile(audio, (err, data) => {
        resolve(data);
      });
    } else {
      let salt = Date.now();
      let sign = md5(appKey + query + salt + appAuth);

      let postData = {
        q: query,
        langType: 'en',
        appKey: appKey,
        salt: salt,
        sign: sign,
        voice: '5'
      };
      //从有道里取
      request({
        url: 'https://openapi.youdao.com/ttsapi',
        method: 'post',
        params: postData,
        responseType: 'arraybuffer'
      })
        .then(oResult => {
          fs.writeFile(path + query + '.mp3', oResult, () => {
          });
          resolve(oResult);
        })
        .catch(err => {
          reject('有道服务器坏了' + err);
        });
    }
  });
};

wordsDao.dict = function (word, noChange) {
  return new Promise(resolve => {
    let srcWord = word;
    if (!noChange) word = word.toLocaleLowerCase();
    if (dict[word]) {
      resolve(dict[word]);
    } else {
      wordsDao.getWord(word)
        .then(ref => {
          let yb = '';
          let cx = '';
          let sy = '';
          let wy = false;
          let oyb = {};
          let ocx = {};
          let osy = {};
          let audio = '';
          let wyaudio = ['p', 'jh', 'sh'];
          for (let i = 0; i < ref.length; i++) {
            if (ref[i].c[0] === 1) {
              yb = ref[i].yb;
              cx = ref[i].cx;
              sy = ref[i].sy;
              if (ref[i].audio) audio = ref[i].audio;
              wy = true;
              break;
            } else {
              if (ref[i].yb) oyb[ref[i].yb] = (ref[i].yb in oyb) ? oyb[ref[i].yb] + 1 : 1;
              if (ref[i].uk) oyb[ref[i].uk] = (ref[i].yb in oyb) ? oyb[ref[i].uk] + 1 : 1;
              if (ref[i].cx) ocx[ref[i].cx] = (ref[i].cx in ocx) ? ocx[ref[i].cx] + 1 : 1;
              if (ref[i].sy) osy[ref[i].sy] = (ref[i].sy in osy) ? osy[ref[i].sy] + 1 : 1;
              if (ref[i].audio && audio === '') audio = ref[i].audio;
            }
          }
          if (!wy) {
            let numyb = 0;
            let numcx = 0;
            let numsy = 0;
            for (let key in oyb) {
              if (oyb[key] > numyb) {
                numyb = oyb[key];
                yb = key;
              }
            }
            for (let key in ocx) {
              if (ocx[key] > numcx) {
                numcx = ocx[key];
                cx = key;
              }
            }
            for (let key in osy) {
              if (osy[key] > numsy) {
                numsy = osy[key];
                sy = key;
              }
            }
          }
          if (audio === '') {
            for (let j = 0; j < 3; j++) {
              if (fs.existsSync(dictPath + '/wyaudio/' + wyaudio[j] + '/' + word + '.mp3')) {
                audio = '/dict/wyaudio/' + wyaudio[j] + '/' + word + '.mp3';
                break;
              }
              if (fs.existsSync(dictPath + '/wyaudio/' + wyaudio[j] + '/' + srcWord + '.mp3')) {
                audio = '/dict/wyaudio/' + wyaudio[j] + '/' + srcWord + '.mp3';
                break;
              }
            }
          } else audio = '/dict/wyaudio' + audio;
          dict[word] = [yb, cx, sy, audio];
          resolve(dict[word]);
        });
    }
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
