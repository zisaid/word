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

/**
 * @api {npm} .init 初始化
 * @apiDescription 初始化
 * @apiGroup Word
 * @apiParam {string} wordDb settings.db
 * @apiParam {string} dictpath settings.dictPath
 * @apiParam {string} youdaoAppKey 有道接口的appKey
 * @apiParam {string} youdaoAppAuth 有道接口的appAuth
 * @apiParam {object} mongoServer setting.mongo
 * @apiParam {object} redisServer setting.redis
 * @apiVersion 0.0.1
 */
wordsDao.init = function (wordDb, dictpath, youdaoAppKey, youdaoAppAuth, mongoServer, redisServer) {
  mongo = mongoServer;
  redis = redisServer;
  dbRes = wordDb;
  dictPath = dictpath;
  appKey = youdaoAppKey;
  appAuth = youdaoAppAuth;
};

/**
 * @api {npm} .code2words 该教材的单词表
 * @apiDescription 取教材单词列表
 * @apiGroup Word
 * @apiParam {number} code 教材或章节代码
 * @apiSuccessExample {array} 示例
 * [
 *   {
 *     "_id": "5c94d832d51b8aef0483be6e",
 *     "c": [
 *       4649,
 *       4726,
 *       4730,
 *       4731
 *     ],
 *     "w": "a",
 *     "yb": "[ə]",
 *     "cx": "art.",
 *     "sy": "一（个）",
 *     "audio": "/jh/a.mp3"
 *   },
 *   {
 *     "_id": "5c22f718bcd4496b710ae989",
 *     "c": [
 *       4386,
 *       4403,
 *       4405
 *     ],
 *     "w": "a",
 *     "cx": "article.",
 *     "definition": "one; every or each; used when saying how much of something there is",
 *     "example": "They left the party an hour ago; I need a new car; I run three times a week.",
 *     "sy": "一（个）；每一（个），用于表示数量",
 *     "yb": "[ə, eɪ]",
 *     "audio": "/jh/a.mp3"
 *   },
 *   {
 *     "_id": "5c1a57c0856d95b8809b65e6",
 *     "c": [
 *       1000000
 *     ],
 *     "w": "a",
 *     "uk": "cappella ˌæ kæˈpelә",
 *     "us": "ˌɑ kәˈpɛlә#ˌæ-"
 *   }
 * ]
 * @apiVersion 0.0.1
 */
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

/**
 * @api {npm} .getWord 该单词所有数据
 * @apiDescription 找到不同教材的相同单词
 * @apiGroup Word
 * @apiParam {string} word 要找的单词
 * @apiSuccessExample {array} 示例
 * [
 *   {
 *     "_id": "5c94d832d51b8aef0483be6e",
 *     "c": [
 *       4649,
 *       4726,
 *       4730,
 *       4731
 *     ],
 *     "w": "a",
 *     "yb": "[ə]",
 *     "cx": "art.",
 *     "sy": "一（个）",
 *     "audio": "/jh/a.mp3"
 *   },
 *   {
 *     "_id": "5c22f718bcd4496b710ae989",
 *     "c": [
 *       4386,
 *       4403,
 *       4405
 *     ],
 *     "w": "a",
 *     "cx": "article.",
 *     "definition": "one; every or each; used when saying how much of something there is",
 *     "example": "They left the party an hour ago; I need a new car; I run three times a week.",
 *     "sy": "一（个）；每一（个），用于表示数量",
 *     "yb": "[ə, eɪ]",
 *     "audio": "/jh/a.mp3"
 *   },
 *   {
 *     "_id": "5c1a57c0856d95b8809b65e6",
 *     "c": [
 *       1000000
 *     ],
 *     "w": "a",
 *     "uk": "cappella ˌæ kæˈpelә",
 *     "us": "ˌɑ kәˈpɛlә#ˌæ-"
 *   }
 * ]
 * @apiVersion 0.0.1
 */
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

/**
 * @api {npm} .getYoudao 取单词的有道数据
 * @apiDescription 取单词的有道数据
 * @apiGroup Word
 * @apiParam {string} word 要找的单词
 * @apiSuccessExample {object} 示例
 * 暂无
 * @apiVersion 0.0.1
 */
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

/**
 * @api {npm} .getTts 取单词的有道TTS
 * @apiDescription 取单词的有道TTS
 * @apiGroup Word
 * @apiParam {string} query 要找的单词
 * @apiSuccessExample {mp3} 示例
 * mp3数据流
 * @apiVersion 0.0.1
 */
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

/**
 * @api {npm} .dict 自己的词典
 * @apiDescription 如果外研版有给外研，否则其它版本，都没有给有道
 * @apiGroup Word
 * @apiParam {string} word 要找的单词
 * @apiParam {bool} noChange 是否保持原样
 * @apiSuccessExample {object} 示例
 * 暂无
 * @apiVersion 0.0.1
 */
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
