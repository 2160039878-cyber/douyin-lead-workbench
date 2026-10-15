'use strict';
const { build, Platform, Arch } = require('electron-builder');
const { WineVmManager } = require('app-builder-lib/out/vm/WineVm');
const original = WineVmManager.prototype.execWine;
WineVmManager.prototype.execWine = function (args) {
  // electron-builder 26.15.3 用仅含 __COMPAT_LAYER 的环境启动 NSIS，Windows 缺少 SystemRoot 会 spawn UNKNOWN。
  // 只补齐系统路径，不把开发机密钥传给卸载程序生成器。
  if (process.platform === 'win32') {
    const env = {};
    for (const key of ['SystemRoot','WINDIR','PATH','TEMP','TMP','COMSPEC','USERPROFILE','LOCALAPPDATA','APPDATA']) {
      const found = Object.keys(process.env).find(k=>k.toLowerCase()===key.toLowerCase());
      if (found) env[key] = process.env[found];
    }
    args = { ...args, options: { ...args.options, env: { ...env, ...args.options?.env } } };
  }
  return original.call(this, args);
};
build({ targets: Platform.WINDOWS.createTarget(['nsis','portable'], Arch.x64) }).catch(e=>{console.error(e.message);process.exitCode=1});
