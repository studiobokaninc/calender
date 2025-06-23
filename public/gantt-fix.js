/**
 * Gantt Chart Fixes
 * このスクリプトはgantt-task-reactの問題を修正します:
 * 1. マウスホイールスクロール時の無限ループエラーを修正
 * 2. スクロールボタンの機能を修正
 * 3. キーボードナビゲーションを改善
 * 4. 依存関係の表示を改善
 */

// DOMの読み込み完了後に実行
document.addEventListener('DOMContentLoaded', function() {
  // 最初のパッチ適用
  setTimeout(applyPatches, 1000);
  
  // Gantt要素を監視して動的に追加された場合もパッチを適用
  const observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
      if (mutation.addedNodes && mutation.addedNodes.length > 0) {
        for (let i = 0; i < mutation.addedNodes.length; i++) {
          const node = mutation.addedNodes[i];
          if (node.classList && node.classList.contains('gantt-container')) {
            setTimeout(applyPatches, 200);
            break;
          }
        }
      }
    });
  });
  
  observer.observe(document.body, { childList: true, subtree: true });
});

/**
 * すべての修正パッチを適用する関数
 */
function applyPatches() {
  fixTaskItemComponent();
  fixScrollButtons();
  addKeyboardNavigation();
  fixMouseWheelScroll();
  fixScrollButtonStyles();
  defineGlobalScrollFunctions();
  renderDependencyLines();
}

/**
 * TaskItem2コンポーネントの無限ループを修正
 */
function fixTaskItemComponent() {
  const ganttElements = document.querySelectorAll('.gantt-container');
  if (ganttElements.length === 0) return;
  
  // すでに修正済みかチェック
  if (window.taskItemFixed) return;
  
  // オリジナルのhandleWheel2関数を保存
  const originalHandleWheel = window.handleWheel2;
  
  // 新しいホイールハンドラー関数
  window.handleWheel2 = function(event) {
    // デフォルトの動作を停止
    event.preventDefault();
    
    const ganttContainer = event.currentTarget;
    if (!ganttContainer) return;
    
    const scrollContainer = ganttContainer.querySelector('.gantt-scroll-container');
    if (!scrollContainer) return;
    
    // Shiftキーが押されている場合は横スクロール
    const deltaY = event.deltaY;
    const deltaX = event.shiftKey ? deltaY : event.deltaX;
    
    // スクロール量を調整
    const scrollAmount = 30;
    
    if (Math.abs(deltaX) > 0) {
      scrollContainer.scrollLeft += deltaX > 0 ? scrollAmount : -scrollAmount;
    } else if (Math.abs(deltaY) > 0 && !event.shiftKey) {
      scrollContainer.scrollTop += deltaY > 0 ? scrollAmount : -scrollAmount;
    }
  };
  
  window.taskItemFixed = true;
  console.log('TaskItem2コンポーネントの修正を適用しました');
}

/**
 * スクロールボタンの機能を修正
 */
function fixScrollButtons() {
  const ganttElements = document.querySelectorAll('.gantt-container');
  ganttElements.forEach(gantt => {
    const scrollContainer = gantt.querySelector('.gantt-scroll-container');
    const scrollLeftBtn = gantt.querySelector('.scroll-left-btn');
    const scrollRightBtn = gantt.querySelector('.scroll-right-btn');
    
    if (scrollLeftBtn && scrollRightBtn && scrollContainer) {
      // 既存のイベントリスナーを削除
      const newScrollLeftBtn = scrollLeftBtn.cloneNode(true);
      const newScrollRightBtn = scrollRightBtn.cloneNode(true);
      
      scrollLeftBtn.parentNode.replaceChild(newScrollLeftBtn, scrollLeftBtn);
      scrollRightBtn.parentNode.replaceChild(newScrollRightBtn, scrollRightBtn);
      
      // 新しいイベントリスナーを追加
      newScrollLeftBtn.addEventListener('click', function() {
        scrollContainer.scrollLeft -= 100;
      });
      
      newScrollRightBtn.addEventListener('click', function() {
        scrollContainer.scrollLeft += 100;
      });
      
      // ボタンのスタイルを改善
      newScrollLeftBtn.style.zIndex = '10';
      newScrollRightBtn.style.zIndex = '10';
      newScrollLeftBtn.style.opacity = '1';
      newScrollRightBtn.style.opacity = '1';
    }
  });
  
  console.log('スクロールボタンの修正を適用しました');
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
      
      const scrollContainer = newGantt.querySelector('.gantt-scroll-container');
      if (!scrollContainer) return;
      
      // Shiftキーが押されている場合は横スクロール、それ以外は縦スクロール
      if (e.shiftKey) {
        scrollContainer.scrollLeft += e.deltaY > 0 ? 60 : -60;
      } else {
        scrollContainer.scrollTop += e.deltaY > 0 ? 60 : -60;
      }
    }, { passive: false });
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
 * スクロールボタンのスタイルを修正
 */
function fixScrollButtonStyles() {
  // CSSスタイルを追加
  if (!document.getElementById('gantt-fix-styles')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'gantt-fix-styles';
    styleEl.textContent = `
      .scroll-left-btn, .scroll-right-btn {
        background-color: rgba(255, 255, 255, 0.8) !important;
        border: 1px solid #ccc !important;
        border-radius: 4px !important;
        padding: 5px 10px !important;
        cursor: pointer !important;
        z-index: 100 !important;
        opacity: 0.8 !important;
        transition: opacity 0.3s ease !important;
      }
      
      .scroll-left-btn:hover, .scroll-right-btn:hover {
        opacity: 1 !important;
        background-color: #f0f0f0 !important;
      }
      
      .gantt-container {
        position: relative !important;
      }
      
      .gantt-scroll-container {
        scroll-behavior: smooth !important;
      }
      
      /* 依存関係線のスタイル */
      .dependency-line {
        stroke: #555;
        stroke-width: 1.5px;
        stroke-dasharray: 4;
        fill: none;
        pointer-events: none;
      }
      
      .dependency-arrow {
        fill: #555;
        pointer-events: none;
      }
    `;
    document.head.appendChild(styleEl);
  }
  
  console.log('スクロールボタンのスタイルを修正しました');
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

/**
 * 依存関係の線を描画
 */
function renderDependencyLines() {
  // 既存のSVG要素を削除
  const existingSvg = document.getElementById('dependency-lines-svg');
  if (existingSvg) {
    existingSvg.remove();
  }
  
  // Gantt要素が存在するかチェック
  const ganttContainer = document.querySelector('.gantt-container');
  if (!ganttContainer) return;
  
  // SVG要素を作成
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'dependency-lines-svg';
  svg.style.position = 'absolute';
  svg.style.top = '0';
  svg.style.left = '0';
  svg.style.width = '100%';
  svg.style.height = '100%';
  svg.style.pointerEvents = 'none';
  svg.style.zIndex = '5';
  
  // タスク要素を取得
  const taskElements = ganttContainer.querySelectorAll('.gantt-task');
  
  // 1秒後に依存関係を描画（ガントチャートが完全に描画された後）
  setTimeout(() => {
    // タスク要素をループ
    taskElements.forEach(taskEl => {
      // タスクIDを取得
      const taskId = taskEl.getAttribute('data-task-id');
      if (!taskId) return;
      
      // 依存関係を持つタスクを検索
      const dependentTasks = Array.from(taskElements).filter(depEl => {
        const depTaskId = depEl.getAttribute('data-task-id');
        if (!depTaskId) return false;
        
        // 依存関係データを取得（data-dependencies属性またはカスタム属性から）
        const dependencies = depEl.getAttribute('data-dependencies');
        if (!dependencies) return false;
        
        // 依存関係をパース（カンマ区切りまたはJSON形式）
        try {
          const deps = dependencies.includes('[') 
            ? JSON.parse(dependencies) 
            : dependencies.split(',').map(d => d.trim());
          return deps.includes(taskId);
        } catch (e) {
          return false;
        }
      });
      
      // 依存関係のタスクごとに線を描画
      dependentTasks.forEach(depTask => {
        drawDependencyLine(taskEl, depTask, svg);
      });
    });
    
    // SVGをガントチャートに追加
    ganttContainer.appendChild(svg);
  }, 1000);
  
  console.log('依存関係の描画を設定しました');
}

/**
 * 2つのタスク要素間に依存関係の線を描画
 */
function drawDependencyLine(sourceTask, targetTask, svg) {
  // 各タスクの位置を取得
  const sourceRect = sourceTask.getBoundingClientRect();
  const targetRect = targetTask.getBoundingClientRect();
  const containerRect = svg.parentElement.getBoundingClientRect();
  
  // コンテナに対する相対位置に変換
  const sourceX = sourceRect.right - containerRect.left;
  const sourceY = sourceRect.top + sourceRect.height / 2 - containerRect.top;
  const targetX = targetRect.left - containerRect.left;
  const targetY = targetRect.top + targetRect.height / 2 - containerRect.top;
  
  // 線のパスを作成
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('class', 'dependency-line');
  
  // 制御点の計算（ベジェ曲線用）
  const controlX1 = sourceX + 20;
  const controlX2 = targetX - 20;
  
  // パスデータを設定（S字カーブ）
  path.setAttribute(
    'd',
    `M ${sourceX} ${sourceY} C ${controlX1} ${sourceY}, ${controlX2} ${targetY}, ${targetX} ${targetY}`
  );
  
  // 矢印を作成
  const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  arrow.setAttribute('class', 'dependency-arrow');
  
  // 矢印の頂点を計算
  const arrowSize = 5;
  const angle = Math.atan2(targetY - sourceY, targetX - sourceX);
  const x1 = targetX - arrowSize * Math.cos(angle) - arrowSize * Math.sin(angle - Math.PI / 2);
  const y1 = targetY - arrowSize * Math.sin(angle) + arrowSize * Math.cos(angle - Math.PI / 2);
  const x2 = targetX;
  const y2 = targetY;
  const x3 = targetX - arrowSize * Math.cos(angle) - arrowSize * Math.sin(angle + Math.PI / 2);
  const y3 = targetY - arrowSize * Math.sin(angle) + arrowSize * Math.cos(angle + Math.PI / 2);
  
  arrow.setAttribute('points', `${x1},${y1} ${x2},${y2} ${x3},${y3}`);
  
  // SVGに追加
  svg.appendChild(path);
  svg.appendChild(arrow);
} 