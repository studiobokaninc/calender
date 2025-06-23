/**
 * Gantt Chart Fixes
 * このスクリプトはgantt-task-reactの問題を修正します:
 * 1. マウスホイールスクロール時の無限ループエラーを修正
 * 2. スクロールボタンの機能を修正
 * 3. キーボードナビゲーションを改善
 * 4. タスク移動時のスクロール位置保持を強化
 * 5. 依存関係による移動制約を完全に無効化
 */

// 即時実行関数で実行する（早期適用のため）
(function() {
  // グローバル変数
  window.__GANTT_FIX_APPLIED = false;
  window.__REACT_PATCHED = false;
  window.__DISABLE_DEPENDENCY_CONSTRAINTS = true; // 依存関係制約を常に無効化
  window.__DISABLE_AUTO_SCROLL = true; // 自動スクロールを無効化
  
  // すべてのパッチを試行する最大回数
  const MAX_RETRY_COUNT = 10;
  let retryCount = 0;
  let retryInterval = null;
  
  // 最初のパッチ適用
  function initialPatch() {
    if (window.__GANTT_FIX_APPLIED) {
      console.log('ガントチャート修正パッチは既に適用されています。');
      clearInterval(retryInterval);
      return;
    }
    
    console.log('Gantt初期パッチを適用中... 試行回数:', retryCount + 1);
    
    // React DevToolsからアクセスできるコンポーネントを特定するためのヘルパー
    window.__getGanttInternals = function() {
      return {
        originalHandleWheel2: window.handleWheel2,
        originalTaskItem2: window.TaskItem2,
        taskGanttContent: window.TaskGanttContent2
      };
    };
    
    // React本体を検出するための工夫
    let React = window.React;
    if (!React) {
      // Reactがグローバルオブジェクトにない場合、DOMから検出を試みる
      console.log('グローバルReactオブジェクトが見つかりません。DOMから検出を試みます...');
      
      // すべてのスクリプトタグを検索
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        if (script.src && script.src.includes('react')) {
          console.log('Reactスクリプトを検出:', script.src);
          // スクリプトが見つかったら、React定義を待機
          setTimeout(() => {
            if (window.React) {
              console.log('Reactが検出されました。パッチを適用します。');
              applyReactPatches(window.React);
            }
          }, 100);
          break;
        }
      }
    } else {
      console.log('グローバルReactオブジェクトが見つかりました。パッチを適用します。');
      applyReactPatches(React);
    }
    
    // すぐにパッチを適用
    applyPatches();
    
    // 遅延して再パッチを適用（DOMが完全に読み込まれた後に）
    setTimeout(applyPatches, 500);
  setTimeout(applyPatches, 1000);
  
    window.__GANTT_FIX_APPLIED = true;
    
    // React関連のパッチが適用されたかを確認
    if (retryCount < MAX_RETRY_COUNT && !window.__REACT_PATCHED) {
      retryCount++;
      console.log(`Reactパッチの適用に失敗しました。${retryCount}/${MAX_RETRY_COUNT}回目の再試行を行います...`);
      setTimeout(initialPatch, 500);
    } else if (window.__REACT_PATCHED) {
      console.log('Reactパッチが正常に適用されました。');
      clearInterval(retryInterval);
    } else if (retryCount >= MAX_RETRY_COUNT) {
      console.warn(`最大試行回数(${MAX_RETRY_COUNT})に達しました。Reactパッチの適用に失敗しました。`);
      clearInterval(retryInterval);
    }
  }
  
  // Reactのパッチを適用する関数
  function applyReactPatches(React) {
    // ★★★ 冒頭の return を削除し、有効化 ★★★
    // console.log('applyReactPatches: デバッグのため再度無効化');
    // return;
    
    if (!React || !React.useEffect || window.__REACT_PATCHED) return; // ガード節は有効なまま
    
    console.log('ReactのuseEffectをパッチ適用中...');
    
    // useEffectのオリジナル関数を保存
    const originalUseEffect = React.useEffect;
    
    // useEffectのオーバーライド (有効な状態)
    React.useEffect = function(effect, deps) {
      const stack = new Error().stack || '';
      if (stack.includes('TaskItem') || stack.includes('GanttContent') || 
          stack.includes('TaskGantt') || stack.includes('Gantt')) {
        return originalUseEffect(function() {
          try { return effect(); } catch (e) { console.error('...'); return undefined;}
        }, []);
      }
      return originalUseEffect(effect, deps);
    };
    
    // useLayoutEffectも同様にパッチ (有効な状態)
    if (React.useLayoutEffect) {
      const originalUseLayoutEffect = React.useLayoutEffect;
      React.useLayoutEffect = function(effect, deps) {
        const stack = new Error().stack || '';
        if (stack.includes('TaskItem') || stack.includes('GanttContent') || 
            stack.includes('TaskGantt') || stack.includes('Gantt')) {
          return originalUseLayoutEffect(function() {
            try { return effect(); } catch (e) { console.error('...'); return undefined;}
          }, []);
        }
        return originalUseLayoutEffect(effect, deps);
      };
    }
    
    window.__REACT_PATCHED = true;
    console.log('Reactパッチが正常に適用されました！');
  }
  
  // DOMの読み込み完了後に実行
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialPatch);
  } else {
    // すでにDOMが読み込まれている場合は即時実行
    initialPatch();
  }
  
  // 定期的にパッチの適用状態を確認
  retryInterval = setInterval(() => {
    if (window.__GANTT_FIX_APPLIED && window.__REACT_PATCHED) {
      console.log('すべてのパッチが正常に適用されました。');
      clearInterval(retryInterval);
    } else if (retryCount < MAX_RETRY_COUNT) {
      initialPatch();
    } else {
      console.warn('最大試行回数に達しました。パッチの適用を終了します。');
      clearInterval(retryInterval);
    }
  }, 2000);
  
  // DOMの変更を監視して自動的に修正を適用
  const observer = new MutationObserver((mutations) => {
    // ガントチャート要素を検索
    let shouldApplyPatch = false;
    
    mutations.forEach(mutation => {
      if (mutation.addedNodes && mutation.addedNodes.length > 0) {
        // 追加されたノードを調査
        for (let i = 0; i < mutation.addedNodes.length; i++) {
          const node = mutation.addedNodes[i];
          
          // HTMLElementかつクラス名を持つ要素のみを処理
          if (node.classList && 
             (node.classList.contains('gantt-container') || 
              node.classList.contains('gantt-task') || 
              node.classList.contains('gantt-viewport'))) {
            shouldApplyPatch = true;
            break;
          }
        }
      }
    });
    
    if (shouldApplyPatch) {
      console.log('ガントチャート要素を検出しました - パッチを適用します');
      // 非同期で実行して最適化
      setTimeout(applyPatches, 0);
    }
  });
  
  // MutationObserverを安全に設定
  if (document.body) {
  observer.observe(document.body, { childList: true, subtree: true });
  } else {
    // document.bodyがまだない場合、DOMContentLoadedを待つ
    document.addEventListener('DOMContentLoaded', () => {
      if (document.body) {
  observer.observe(document.body, { childList: true, subtree: true });
      }
});
  }
})();

/**
 * すべての修正パッチを適用する関数
 */
function applyPatches() {
  console.log('ガントチャート修正パッチを適用します... [全パッチ有効]');
  
  try {
    // ★★★ 全ての呼び出しのコメントアウトを解除 (有効化) ★★★
    disableDependencyConstraints();
  fixScrollButtons();
    fixMouseWheelScroll();
  addKeyboardNavigation();
    preserveScrollPosition();
    fixDependencyArrows();
    disableAutoScroll();
    defineGlobalScrollFunctions();
    patchTaskMovement();
    patchGanttDateRange();
    
    console.log('ガントチャート修正パッチが正常に適用されました！');
    
    if (typeof window.onGanttPatchApplied === 'function') {
      window.onGanttPatchApplied();
    }
  } catch (error) {
    console.error('ガントチャート修正パッチの適用中にエラーが発生しました:', error);
  }
}

/**
 * 依存関係の矢印を表示するが、移動制約は設けない
 */
function fixDependencyArrows() {
  // 依存関係矢印は視覚的な表示のみとし、動作には影響しないようにする
  try {
    // 既存のDOMイベントを上書きして無効化
    const ganttContentElems = document.querySelectorAll('.gantt');
    if (ganttContentElems.length === 0) return;
    
    // 依存関係による移動制約を完全に無効化
    window.__DISABLE_DEPENDENCY_CONSTRAINTS = true;
    console.log('依存関係による移動制約を無効化しました');
    
    // 依存関係の処理関数を完全に無効化
    if (window.TaskItem2 && window.TaskItem2.prototype) {
      if (window.TaskItem2.prototype.handleMoveBy) {
        const originalMoveBy = window.TaskItem2.prototype.handleMoveBy;
        window.TaskItem2.prototype.handleMoveBy = function(duration) {
          // 依存関係の検証をスキップ
          if (this.props && this.props.onDateChange) {
            const newStart = new Date(this.props.task.start.getTime() + duration);
            const newEnd = new Date(this.props.task.end.getTime() + duration);
            this.props.onDateChange(this.props.task, newStart, newEnd);
            return;
          }
          
          // オリジナルの関数を呼び出す（フォールバック）
          try {
            originalMoveBy.call(this, duration);
          } catch (e) {
            console.error('handleMoveBy呼び出しエラー:', e);
          }
        };
      }
      
      // 依存関係チェック関数を無効化
      if (window.dependencies && window.dependencies.isValidDependency) {
        window.dependencies.isValidDependency = function() {
          return true; // 常に有効と見なす
        };
      }
    }
    
    // カスタムスタイルを適用
    const style = document.createElement('style');
    style.textContent = `
      .arrow {
        stroke: rgba(66, 133, 244, 0.5) !important;
        stroke-width: 1 !important;
      }
      .arrow-head {
        fill: rgba(66, 133, 244, 0.5) !important;
      }
    `;
    document.head.appendChild(style);
  } catch (e) {
    console.error('依存関係矢印の修正中にエラーが発生しました:', e);
  }
}

/**
 * 自動スクロールを無効化する
 */
function disableAutoScroll() {
  try {
    console.log('自動スクロールの無効化パッチを適用中...');
    
    // スタイルを追加して、スクロール位置を固定
    const styleEl = document.createElement('style');
    styleEl.textContent = `
      /* スクロール位置を固定するスタイル */
      .gantt-scroll-container {
        scroll-behavior: auto !important;
      }
      .gantt-horizontal-container,
      .gantt-vertical-scroll-container {
        scroll-behavior: auto !important;
      }
    `;
    document.head.appendChild(styleEl);
    
    // スクロール関数をオーバーライドして自動スクロールを防止
    const originalScrollTo = Element.prototype.scrollTo;
    const originalScrollBy = Element.prototype.scrollBy;
    
    // scrollToとscrollByをモンキーパッチして、ガントチャート要素のみ無効化
    Element.prototype.scrollTo = function(...args) {
      if (this.classList && 
         (this.classList.contains('gantt-scroll-container') || 
          this.classList.contains('gantt-horizontal-container') || 
          this.classList.contains('gantt-vertical-scroll-container'))) {
        // タスク移動中は自動スクロールを無効化
        if (window.__DRAGGING_TASK) {
          return;
        }
      }
      return originalScrollTo.apply(this, args);
    };
    
    Element.prototype.scrollBy = function(...args) {
      if (this.classList && 
         (this.classList.contains('gantt-scroll-container') || 
          this.classList.contains('gantt-horizontal-container') || 
          this.classList.contains('gantt-vertical-scroll-container'))) {
        // タスク移動中は自動スクロールを無効化
        if (window.__DRAGGING_TASK) {
          return;
        }
      }
      return originalScrollBy.apply(this, args);
    };
    
    console.log('自動スクロールの無効化パッチを適用しました');
  } catch (e) {
    console.error('自動スクロール無効化中にエラーが発生しました:', e);
  }
}

/**
 * スクロール位置を保持する
 */
function preserveScrollPosition() {
  // ガントチャートのスクロール位置を保存・復元する
  try {
    // スクロール位置を保存する変数
    let lastScrollLeft = 0;
    let lastScrollTop = 0;
    let isScrolling = false;
    
    // スクロール位置を保存する間隔 (ミリ秒)
    const SCROLL_SAVE_INTERVAL = 100;
    let scrollTimer = null;
    
    // タスクドラッグ中かどうかのフラグ
    window.__DRAGGING_TASK = false;
    
    // スクロール位置の監視を開始
    function startScrollMonitoring() {
      const ganttContainer = document.querySelector('.gantt-container');
      const horizontalContainer = document.querySelector('.gantt-horizontal-container');
      const verticalContainer = document.querySelector('.gantt-vertical-scroll-container');
      
      if (!ganttContainer || !horizontalContainer || !verticalContainer) {
        // 要素が見つからない場合は後で再試行
        setTimeout(startScrollMonitoring, 500);
        return;
      }
      
      // スクロール位置を保存
      function saveScrollPosition() {
        if (horizontalContainer) lastScrollLeft = horizontalContainer.scrollLeft;
        if (verticalContainer) lastScrollTop = verticalContainer.scrollTop;
        isScrolling = false;
      }
      
      // スクロールイベントリスナー
      function handleScroll() {
        isScrolling = true;
        
        // スクロール終了後に位置を保存
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(saveScrollPosition, SCROLL_SAVE_INTERVAL);
      }
      
      // イベントリスナーを追加
      if (horizontalContainer) {
        horizontalContainer.addEventListener('scroll', handleScroll, { passive: true });
      }
      
      if (verticalContainer) {
        verticalContainer.addEventListener('scroll', handleScroll, { passive: true });
      }
      
      // タスクドラッグ開始イベント
      document.addEventListener('mousedown', function(e) {
        if (e.target && e.target.closest && 
            e.target.closest('.gantt-task-foreground-area, .bar-wrapper')) {
          window.__DRAGGING_TASK = true;
          saveScrollPosition(); // ドラッグ開始時にスクロール位置を保存
        }
      }, true);
      
      // タスクドラッグ終了イベント
      document.addEventListener('mouseup', function() {
        if (window.__DRAGGING_TASK) {
          window.__DRAGGING_TASK = false;
          // ドラッグ終了後に保存したスクロール位置を復元
          setTimeout(() => {
            restoreScrollPosition();
          }, 10);
        }
      }, true);
      
      console.log('スクロール位置の監視を開始しました');
    }
    
    // 初期化
    startScrollMonitoring();
    
    // グローバルに復元関数を公開
    window.restoreGanttScrollPosition = function() {
      const horizontalContainer = document.querySelector('.gantt-horizontal-container');
      const verticalContainer = document.querySelector('.gantt-vertical-scroll-container');
      
      if (horizontalContainer && lastScrollLeft > 0) {
        horizontalContainer.scrollLeft = lastScrollLeft;
      }
      
      if (verticalContainer && lastScrollTop > 0) {
        verticalContainer.scrollTop = lastScrollTop;
      }
      
      console.log('スクロール位置を復元しました:', { left: lastScrollLeft, top: lastScrollTop });
    };
    
    // 通常のスクロール位置復元
    function restoreScrollPosition() {
      window.restoreGanttScrollPosition();
    }
  } catch (e) {
    console.error('スクロール位置保持の設定中にエラーが発生しました:', e);
  }
}

/**
 * タスク移動の動作を修正するパッチ
 */
function patchTaskMovement() {
  try {
    console.log('タスク移動パッチを適用中...');
    
    // ReactとGanttコンポーネントを取得
    const React = window.React;
    if (!React) {
      console.warn('タスク移動パッチ: Reactオブジェクトが見つかりません');
      return;
    }
    
    // ライブラリ内のタスク移動ロジックを無効化するため、TaskItemコンポーネントを検索
    const taskItemElements = document.querySelectorAll('.gantt-task-row');
    if (taskItemElements.length === 0) {
      console.warn('タスク移動パッチ: タスク要素が見つかりません。後で再試行します。');
      setTimeout(patchTaskMovement, 1000);
      return;
    }
    
    // タスク移動イベントを改善するためのカスタムスタイルを追加
    const style = document.createElement('style');
    style.textContent = `
      .gantt-task-foreground-area {
        cursor: move !important;
      }
      .gantt-task {
        transition: opacity 0.1s ease-in-out;
      }
      .gantt-task.being-dragged {
        opacity: 0.7;
        cursor: grabbing !important;
      }
    `;
    document.head.appendChild(style);
    
    // 依存関係のモック関数を作成
    if (window.dependencies === undefined) {
      window.dependencies = {
        isValidDependency: function() { return true; },
        moveDatesByDependencies: function(taskId, dates) { return dates; }
      };
      console.log('依存関係処理用のモック関数を作成しました');
    }
    
    // MutationObserverを使用して新しく追加されるタスク要素を監視
    const taskObserver = new MutationObserver((mutations) => {
      mutations.forEach(mutation => {
        if (mutation.addedNodes && mutation.addedNodes.length > 0) {
          for (let i = 0; i < mutation.addedNodes.length; i++) {
            const node = mutation.addedNodes[i];
            if (node.classList && node.classList.contains('gantt-task')) {
              enhanceTaskElement(node);
            }
          }
        }
      });
    });
    
    // Ganttコンテナを監視
    const ganttContainer = document.querySelector('.gantt-container');
    if (ganttContainer) {
      taskObserver.observe(ganttContainer, { childList: true, subtree: true });
      
      // 既存のタスク要素を強化
      const existingTasks = ganttContainer.querySelectorAll('.gantt-task');
      existingTasks.forEach(enhanceTaskElement);
    }
    
    // タスク要素のドラッグ機能を強化
    function enhanceTaskElement(taskElement) {
      if (!taskElement || taskElement.__enhanced) return;
      
      // 一度だけ処理するためのフラグ
      taskElement.__enhanced = true;
      
      // スクロール位置を保存
      let startScrollLeft = 0;
      let startScrollTop = 0;
      
      // タスク移動開始時
      taskElement.addEventListener('mousedown', (e) => {
        // バーのリサイズハンドルやプログレスバーのクリックは無視
        if (e.target.classList.contains('bar-handle') ||
            e.target.classList.contains('bar-progress')) {
          return;
        }
        
        // スクロール位置を保存
        const horizontalContainer = document.querySelector('.gantt-horizontal-container');
        const verticalContainer = document.querySelector('.gantt-vertical-scroll-container');
        
        if (horizontalContainer) startScrollLeft = horizontalContainer.scrollLeft;
        if (verticalContainer) startScrollTop = verticalContainer.scrollTop;
        
        // ドラッグ中フラグを設定
        window.__DRAGGING_TASK = true;
        
        // クラスを追加してドラッグ中の視覚的フィードバック
        taskElement.classList.add('being-dragged');
      });
      
      // タスク移動中
      document.addEventListener('mousemove', () => {
        if (window.__DRAGGING_TASK) {
          // ドラッグ中はスクロールを防止
          const horizontalContainer = document.querySelector('.gantt-horizontal-container');
          const verticalContainer = document.querySelector('.gantt-vertical-scroll-container');
          
          if (horizontalContainer) horizontalContainer.scrollLeft = startScrollLeft;
          if (verticalContainer) verticalContainer.scrollTop = startScrollTop;
        }
      });
      
      // タスク移動終了時
      taskElement.addEventListener('mouseup', () => {
        // ドラッグ中フラグを解除
        window.__DRAGGING_TASK = false;
        
        // クラスを削除
        taskElement.classList.remove('being-dragged');
        
        // スクロール位置を復元（少し遅延させる）
        setTimeout(() => {
          const horizontalContainer = document.querySelector('.gantt-horizontal-container');
          const verticalContainer = document.querySelector('.gantt-vertical-scroll-container');
          
          if (horizontalContainer) horizontalContainer.scrollLeft = startScrollLeft;
          if (verticalContainer) verticalContainer.scrollTop = startScrollTop;
        }, 10);
      });
    }
    
    console.log('タスク移動パッチを適用しました');
  } catch (e) {
    console.error('タスク移動パッチの適用中にエラーが発生しました:', e);
  }
}

/**
 * ガントチャートコンポーネントをパッチ
 */
function patchGanttComponent() {
  try {
    console.log('Ganttコンポーネントをパッチ適用中...');
    
    // React
    const React = window.React;
    if (!React) {
      console.warn('Ganttコンポーネントのパッチ: Reactオブジェクトが見つかりません');
      return;
    }
    
    // エラーバウンダリコンポーネントの定義
    class ErrorBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
      }
      
      static getDerivedStateFromError(error) {
        return { hasError: true, error };
      }
      
      componentDidCatch(error, errorInfo) {
        console.error('ガントチャートエラー:', error, errorInfo);
      }
      
      render() {
        if (this.state.hasError) {
          return React.createElement('div', { 
            style: { 
              padding: '20px', 
              color: 'red', 
              border: '1px solid red',
              borderRadius: '4px',
              margin: '10px 0'
            } 
          }, `ガントチャートでエラーが発生しました: ${this.state.error && this.state.error.message}`);
        }
        
        return this.props.children;
      }
    }
    
    // パッチ済みのGanttコンポーネント
    function PatchedGantt(props) {
      return React.createElement(
        ErrorBoundary,
        null,
        React.createElement('div', { className: 'patched-gantt-wrapper' }, 
          // 元のGanttコンポーネントを描画
          React.createElement(window.GanttComponent || 'div', props)
        )
      );
    }
    
    // グローバル変数にパッチ済みコンポーネントを保存
    window.PatchedGantt = PatchedGantt;
    
    console.log('Ganttコンポーネントのパッチを適用しました');
  } catch (e) {
    console.error('Ganttコンポーネントのパッチ適用中にエラーが発生しました:', e);
  }
}

/**
 * React内部のコンポーネントに直接パッチを適用
 */
function monkeyPatchReactComponents() {
  // すでに修正済みかチェック
  if (window.reactComponentsPatched) return;
  
  console.log('Reactコンポーネントにモンキーパッチを適用中...');
  
  // Reactのfiberツリーから特定のコンポーネントを探す
  function findReactComponents() {
    // React DevToolsのグローバル変数からfiberを取得
    const devTools = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (!devTools) return null;
    
    // Reactインスタンスを取得
    const reactInstances = devTools.renderers;
    if (!reactInstances || !reactInstances.size) return null;
    
    // 最初のレンダラーを使用
    const renderer = reactInstances.get(1);
    if (!renderer) return null;
    
    // fiberノードを取得
    const fiberRoot = renderer.getFiberRoots().values().next().value;
    if (!fiberRoot) return null;
    
    return {
      devTools,
      renderer,
      fiberRoot
    };
  }
  
  // Reactコンポーネントを探して修正
  const reactComponents = findReactComponents();
  if (reactComponents) {
    console.log('Reactコンポーネントを検出しました、パッチを適用します');
    
    // useStateへのオーバーライドを追加
    if (window.React && window.React.useState) {
      const originalUseState = window.React.useState;
      window.React.useState = function(initialState) {
        // スタックトレースを確認して、問題のコンポーネントからの呼び出しかを判断
        const stack = new Error().stack || '';
        
        // TaskItem2からの呼び出しで、特定のステート更新を防止
        if (stack.includes('TaskItem2') && 
            (typeof initialState === 'boolean' || 
             (typeof initialState === 'object' && initialState !== null && 'x' in initialState))) {
          
          // 固定値を返す
          const state = typeof initialState === 'boolean' ? false : initialState;
          return [state, function() { /* 更新関数を無効化 */ }];
        }
        
        // 通常のuseState呼び出し
        return originalUseState(initialState);
      };
    }
  }
  
  window.reactComponentsPatched = true;
}

/**
 * TaskItem2コンポーネントの無限ループを修正
 */
function fixTaskItemComponent() {
  const ganttElements = document.querySelectorAll('.gantt-container');
  if (ganttElements.length === 0) return;
  
  if (window.taskItemFixed) return;
  
  window.handleWheel2 = function() { return false; };
  
  if (window.TaskItem2 && window.TaskItem2.prototype) {
    console.log('TaskItem2コンポーネントをモンキーパッチ中...');
    const originalRender = window.TaskItem2.prototype.render;
    window.TaskItem2.prototype.render = function() {
      try {
        if (this.setState) {
          const originalSetState = this.setState;
          this.setState = function() {
            const stack = new Error().stack || '';
            if (stack.includes('useEffect')) {
              console.log('...'); return;
            }
            return originalSetState.apply(this, arguments);
          };
          const result = originalRender.apply(this, arguments);
          this.setState = originalSetState;
          return result;
        } else {
          return originalRender.apply(this, arguments);
        }
      } catch (e) {
        console.error('...'); return null;
      }
    };
    if (window.TaskItem2.prototype.componentDidMount) {
      const originalDidMount = window.TaskItem2.prototype.componentDidMount;
      window.TaskItem2.prototype.componentDidMount = function() {
        try { return originalDidMount.apply(this, arguments); } catch (e) { console.error('...'); }
      };
    }
    if (window.TaskItem2.prototype.componentDidUpdate) {
      const originalDidUpdate = window.TaskItem2.prototype.componentDidUpdate;
      window.TaskItem2.prototype.componentDidUpdate = function() {
        try { return originalDidUpdate.apply(this, arguments); } catch (e) { console.error('...'); }
      };
    }
  }
  
  window.taskItemFixed = true;
  console.log('TaskItem2コンポーネントの修正を適用しました');
}

/**
 * 内部スクロールハンドラーを無効化
 */
function disableInternalScrollHandlers() {
  // すでに修正済みかチェック
  if (window.internalScrollHandlersDisabled) return;
  
  // スクロールコンテナを取得
  const scrollContainers = document.querySelectorAll('.gantt-scroll-container, .gantt-task-row, .gantt-table-header');
  
  // 既存のスクロールイベントリスナーを削除するためにクローン
  scrollContainers.forEach(container => {
    if (container && container.parentNode) {
      const clone = container.cloneNode(true);
      container.parentNode.replaceChild(clone, container);
    }
  });
  
  // グローバルオブジェクトから問題のある関数を削除または置き換え
  if (window.ganttTaskRowRef) {
    window.ganttTaskRowRef = {};
  }
  
  // TaskGanttContent2のイベントハンドラーを無効化
  if (window.TaskGanttContent2 && window.TaskGanttContent2.prototype) {
    // スクロールハンドラーを無効化
    window.TaskGanttContent2.prototype.handleWheel = function() {
      return false;
    };
  }
  
  // 他のスクロール関連関数も無効化
  ['handleMouseDown', 'handleMouseMove', 'handleMouseUp', 'handleTouchMove', 'handleTouchStart', 'handleTouchCancel'].forEach(funcName => {
    if (window[funcName]) {
      const originalFunc = window[funcName];
      window[funcName] = function() {
        // 元の関数を呼び出すが、エラーが発生した場合は無視
        try {
          return originalFunc.apply(this, arguments);
        } catch (e) {
          console.warn(`Error in ${funcName}:`, e);
          return false;
        }
      };
    }
  });
  
  window.internalScrollHandlersDisabled = true;
  console.log('内部スクロールハンドラーを無効化しました');
}

/**
 * スクロールボタンの機能を修正（削除）
 */
function fixScrollButtons() {
  // スクロールボタンを非表示にする
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    .scroll-left-btn, .scroll-right-btn {
      display: none !important;
    }
  `;
  document.head.appendChild(styleEl);
  
  console.log('スクロールボタンの修正を適用しました');
}

/**
 * スクロールボタンのスタイルを修正（無効化）
 */
function fixScrollButtonStyles() {
  // スタイル適用なし - ボタンは表示されません
  console.log('スクロールボタンのスタイルを修正しました');
}

/**
 * マウスホイールスクロールの修正
 */
function fixMouseWheelScroll() {
  const ganttElements = document.querySelectorAll('.gantt-container');
  ganttElements.forEach(gantt => {
    // 既存のホイールイベントを削除
    const newGantt = gantt.cloneNode(false);
    while (gantt.firstChild) {
      newGantt.appendChild(gantt.firstChild);
    }
    gantt.parentNode.replaceChild(newGantt, gantt);
    
    // 新しいホイールイベントを追加
    newGantt.addEventListener('wheel', function(e) {
      e.preventDefault();
      e.stopPropagation(); // イベント伝播も停止
      
      const scrollContainer = newGantt.querySelector('.gantt-scroll-container');
      if (!scrollContainer) return;
      
      // requestAnimationFrameを使用してスムーズなスクロールを実現
      requestAnimationFrame(() => {
        // スクロール量を計算
        const horizontalStep = e.deltaX * 0.8;
        const verticalStep = e.deltaY * 0.8;
        
        // シフトキーが押されている場合は横スクロール、それ以外は縦スクロール
      if (e.shiftKey) {
          scrollContainer.scrollLeft += verticalStep;
      } else {
          if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
            scrollContainer.scrollLeft += horizontalStep;
      } else {
            scrollContainer.scrollTop += verticalStep;
      }
      }
      });
    }, { passive: false, capture: true });
  });
  
  console.log('マウスホイールスクロールの修正を適用しました');
}

/**
 * キーボードナビゲーションの追加
 */
function addKeyboardNavigation() {
  // 既存のイベントリスナーを削除
  if (window.keyNavHandler) {
    document.removeEventListener('keydown', window.keyNavHandler);
  }
  
  // 新しいキーボードイベントハンドラー
  window.keyNavHandler = function(e) {
    const ganttElements = document.querySelectorAll('.gantt-container');
    if (ganttElements.length === 0) return;
    
    const scrollContainer = ganttElements[0].querySelector('.gantt-scroll-container');
    if (!scrollContainer) return;
    
    // アクティブな要素がテキスト入力の場合はスキップ
    if (document.activeElement.tagName === 'INPUT' || 
        document.activeElement.tagName === 'TEXTAREA' || 
        document.activeElement.isContentEditable) {
      return;
    }
    
    switch (e.key) {
      case 'ArrowLeft':
        scrollContainer.scrollLeft -= 60;
        e.preventDefault();
        break;
      case 'ArrowRight':
        scrollContainer.scrollLeft += 60;
        e.preventDefault();
        break;
      case 'ArrowUp':
        scrollContainer.scrollTop -= 40;
        e.preventDefault();
        break;
      case 'ArrowDown':
        scrollContainer.scrollTop += 40;
        e.preventDefault();
        break;
    }
  };
  
  document.addEventListener('keydown', window.keyNavHandler);
  console.log('キーボードナビゲーションを追加しました');
}

/**
 * グローバルスクロール関数を定義
 */
function defineGlobalScrollFunctions() {
  // 既に定義済みならスキップ
  if (window.scrollGanttLeft && window.scrollGanttRight) return;
  
  // 水平スクロール関数
  window.scrollGanttLeft = function(amount = 100) {
    const ganttElements = document.querySelectorAll('.gantt-container');
    if (ganttElements.length === 0) return;
    
    const scrollContainer = ganttElements[0].querySelector('.gantt-scroll-container') || 
                           ganttElements[0].querySelector('.gantt-horizontal-container');
    if (scrollContainer) {
      scrollContainer.scrollLeft -= amount;
    }
  };
  
  window.scrollGanttRight = function(amount = 100) {
  const ganttElements = document.querySelectorAll('.gantt-container');
  if (ganttElements.length === 0) return;
  
    const scrollContainer = ganttElements[0].querySelector('.gantt-scroll-container') || 
                           ganttElements[0].querySelector('.gantt-horizontal-container');
    if (scrollContainer) {
      scrollContainer.scrollLeft += amount;
    }
  };
  
  // 垂直スクロール関数
  window.scrollGanttUp = function(amount = 40) {
  const ganttElements = document.querySelectorAll('.gantt-container');
  if (ganttElements.length === 0) return;
  
    const scrollContainer = ganttElements[0].querySelector('.gantt-vertical-scroll-container');
    if (scrollContainer) {
      scrollContainer.scrollTop -= amount;
    }
  };
  
  window.scrollGanttDown = function(amount = 40) {
    const ganttElements = document.querySelectorAll('.gantt-container');
    if (ganttElements.length === 0) return;
    
    const scrollContainer = ganttElements[0].querySelector('.gantt-vertical-scroll-container');
    if (scrollContainer) {
      scrollContainer.scrollTop += amount;
    }
  };
  
  console.log('グローバルスクロール関数を定義しました');
}

// 初期化時にグローバルスクロール関数を定義
defineGlobalScrollFunctions();

// DOMContentLoadedで安全性を確保
document.addEventListener('DOMContentLoaded', function() {
  console.log('DOMContentLoaded - Ganttパッチ適用状態を確認中...');
  
  // パッチが適用されていなければ再適用
  if (!window.__GANTT_DATE_RANGE_PATCHED) {
    console.warn('DOMContentLoaded後もganttDateRangeパッチが適用されていません。再試行します...');
    patchGanttDateRange();
  }
  
  // MemoizedGanttをパッチ
  try {
    // GanttViewコンポーネント内のMemoizedGanttを安全なバージョンに置き換える
    if (window.React && window.React.memo) {
      const originalMemo = window.React.memo;
      const patchedMemo = function(component, areEqual) {
        // Ganttコンポーネントかどうかを判断
        if (component && component.name === 'Gantt') {
          console.log('MemoizedGanttを検出、SafeGanttでラップします');
          // 安全なラッパーでラップ
          const WrappedComponent = function(props) {
            try {
              return component(props);
            } catch (error) {
              console.error('Ganttコンポーネントエラー:', error);
              // エラー時のフォールバックUI
              return window.React.createElement('div', {
                style: { padding: '10px', color: 'red', border: '1px solid red' }
              }, 'ガントチャートの表示中にエラーが発生しました');
            }
          };
          // 元のコンポーネント名を保持
          WrappedComponent.displayName = 'SafeGantt';
          // メモ化して返す
          return originalMemo(WrappedComponent, areEqual);
        }
        // それ以外のコンポーネントは通常のメモ化を適用
        return originalMemo(component, areEqual);
      };
      
      // 既存のmemoを一時的に上書き（30秒後に元に戻す）
      const tempMemo = window.React.memo;
      window.React.memo = patchedMemo;
      setTimeout(() => {
        window.React.memo = tempMemo;
        console.log('React.memoを元に戻しました');
      }, 30000);
      
      console.log('React.memoをパッチしました (30秒間)');
    }
  } catch (memoError) {
    console.error('React.memoパッチ適用中にエラー:', memoError);
  }
});

/**
 * ガントチャートの日付範囲関数をパッチ
 */
function patchGanttDateRange() {
  try {
    // 元の関数を保存
    if (window.ganttDateRange) {
      window.originalGanttDateRange = window.ganttDateRange;
    }
    
    // 修正された日付範囲計算関数
    const patchedGanttDateRange = function(tasks) {
      console.log('パッチされたganttDateRange関数が呼び出されました');
      
      // タスクが空または無効な場合のエラー処理
      if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
        console.warn('ganttDateRange: タスクが空または無効です', tasks);
        
        // デフォルトの日付範囲を返す（今日から30日間）
        const today = new Date();
        const defaultEndDate = new Date();
        defaultEndDate.setDate(today.getDate() + 30);
        
        return {
          start: today,
          end: defaultEndDate
        };
      }
      
      // 有効なタスクだけをフィルタリング
      const validTasks = tasks.filter(task => 
        task && task.start && task.end && 
        task.start instanceof Date && 
        task.end instanceof Date
      );
      
      if (validTasks.length === 0) {
        console.warn('ganttDateRange: 有効な日付を持つタスクがありません');
        
        // デフォルトの日付範囲を返す
        const today = new Date();
        const defaultEndDate = new Date();
        defaultEndDate.setDate(today.getDate() + 30);
        
        return {
          start: today,
          end: defaultEndDate
        };
      }
      
      // 最小・最大日付を計算
      let start = new Date(Math.min(...validTasks.map(task => task.start.getTime())));
      let end = new Date(Math.max(...validTasks.map(task => task.end.getTime())));
      
      // バッファ日数を追加
      const bufferDays = 7;
      start.setDate(start.getDate() - bufferDays);
      end.setDate(end.getDate() + bufferDays);
      
      return { start, end };
    };
    
    // グローバル関数を置き換え
    window.ganttDateRange = patchedGanttDateRange;
    console.log('ganttDateRange関数をパッチしました');
  } catch (e) {
    console.error('ganttDateRange関数のパッチ中にエラーが発生しました:', e);
  }
}

/**
 * 依存関係の制約を完全に無効化する関数
 */
function disableDependencyConstraints() {
  console.log('タスク依存関係の制約を無効化します...');
  
  // グローバルフラグを設定
  window.__DISABLE_DEPENDENCY_CONSTRAINTS = true;
  
  // ライブラリのコンポーネントを取得して制約処理をオーバーライド
  try {
    // gantt-task-reactライブラリのクラスまたは関数を取得
    const ganttLib = window.gantt || window.Gantt;
    
    if (ganttLib) {
      // 依存関係による調整関数をオーバーライド
      if (typeof ganttLib.adjustTaskByDependencies === 'function') {
        const originalAdjust = ganttLib.adjustTaskByDependencies;
        ganttLib.adjustTaskByDependencies = function(task) {
          console.log('依存関係による調整がブロックされました');
          // 何も変更せず元のタスクをそのまま返す
          return task;
        };
        console.log('adjustTaskByDependencies関数を無効化しました');
      }
      
      // プロトタイプ経由でも試行
      if (ganttLib.prototype && typeof ganttLib.prototype.adjustTaskByDependencies === 'function') {
        const originalProtoAdjust = ganttLib.prototype.adjustTaskByDependencies;
        ganttLib.prototype.adjustTaskByDependencies = function(task) {
          console.log('依存関係による調整(prototype)がブロックされました');
          return task;
        };
        console.log('prototype.adjustTaskByDependencies関数を無効化しました');
      }
    }
    
    // MonkeyPatchでcomponentDidUpdateも対象にする
    if (window.React && window.React.Component) {
      const origComponentDidUpdate = window.React.Component.prototype.componentDidUpdate;
      if (origComponentDidUpdate) {
        window.React.Component.prototype.componentDidUpdate = function(...args) {
          try {
            // このコンポーネントがガントチャート関連か確認
            const componentName = this.constructor.name || '';
            if (componentName.includes('Task') || componentName.includes('Gantt')) {
              // 制約関連の処理をブロック
              if (this.adjustTaskByDependencies) {
                this.adjustTaskByDependencies = function(task) { return task; };
              }
            }
            return origComponentDidUpdate.apply(this, args);
          } catch (e) {
            console.error('componentDidUpdateパッチエラー:', e);
          }
        };
      }
    }
    
    console.log('依存関係の制約が完全に無効化されました');
  } catch (error) {
    console.error('依存関係制約の無効化中にエラーが発生しました:', error);
  }
} 