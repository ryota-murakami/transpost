import { defineConfig } from 'wxt'

// WXT 設定: MV3 manifest を生成。action は default_popup を持たせず onClicked を発火させる。
// 翻訳トリガーはツールバークリック(action.onClicked)とキーボードショートカット(commands)の両方。
// OpenAI への fetch を background service worker から行うため host_permissions を付与（CORS回避）。
export default defineConfig({
  // build成果物の出力先。デフォルトの '.output' から 'output' に変更。
  outDir: 'output',
  manifest: {
    name: 'transpost',
    description:
      'X(Twitter)の日本語下書きを英訳＋日本語解説して右側パネルに表示（英語学習用）',
    // storage: 設定(APIキー/モデル/プロンプト)保存。activeTab: トリガー時にアクティブタブへ送信。
    permissions: ['storage', 'activeTab'],
    // OpenAI API への背景fetchを許可（これが無いと service worker の fetch が CORS で失敗）。
    host_permissions: ['https://api.openai.com/*'],
    // 拡張一覧とツールバーの両方に、public 配下の生成済みアイコンを明示的に反映する。
    icons: {
      16: '/icon-16.png',
      32: '/icon-32.png',
      48: '/icon-48.png',
      128: '/icon-128.png',
    },
    // default_popup を置かない＝ツールバーアイコンのクリックで action.onClicked が発火する。
    action: {
      default_icon: {
        16: '/icon-16.png',
        32: '/icon-32.png',
        48: '/icon-48.png',
        128: '/icon-128.png',
      },
    },
    // カスタムショートカット。chrome://extensions/shortcuts で再割当可能。
    commands: {
      'translate-post': {
        suggested_key: { default: 'Ctrl+Shift+Y', mac: 'Command+Shift+Y' },
        description: '日本語を英訳してパネル表示',
      },
    },
  },
})
