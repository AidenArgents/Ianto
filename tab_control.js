// tab_control.js
function openTab(tabName) {
  // 移除所有内容和按钮的 active 状态
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-button').forEach(el => el.classList.remove('active'));

  // 添加当前标签的 active 状态
  const activeTabContent = document.getElementById('tab-' + tabName);
  const activeButton = document.querySelector(`.tab-button[data-tab="${tabName}"]`);

  if (activeTabContent && activeButton) {
    activeTabContent.classList.add('active');
    activeButton.classList.add('active');
  }
}

// 初始化：绑定事件监听器，并默认打开第一个标签页
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.tab-button').forEach(button => {
        button.addEventListener('click', (event) => {
            const tabName = event.currentTarget.getAttribute('data-tab');
            openTab(tabName);
        });
    });

    // 默认打开第一个标签页: 批量勾选
    const defaultTab = document.querySelector('.tab-button').getAttribute('data-tab');
    if (defaultTab) {
        openTab(defaultTab);
    }
});