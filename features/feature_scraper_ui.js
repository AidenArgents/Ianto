// analysis_page.js

document.addEventListener('DOMContentLoaded', async () => {
  const statusElement = document.getElementById('status');
  const titleList = document.getElementById('titleList');
  const copyButton = document.getElementById('copyButton');

  // 从本地存储中读取标题数据
  const data = await chrome.storage.local.get('productTitles');
  const titles = data.productTitles || [];

  if (titles.length === 0) {
    statusElement.textContent = '未找到任何标题。请确保您在正确的电商页面上。';
    copyButton.style.display = 'none'; // 如果没有标题，隐藏复制按钮
    return;
  }
  
  statusElement.style.display = 'none';

  // 渲染标题列表，并添加序号
  titles.forEach((title, index) => {
    const li = document.createElement('li');
    li.textContent = `${index + 1}. ${title}`;
    titleList.appendChild(li);
  });

  // 为复制按钮添加点击事件
  copyButton.addEventListener('click', () => {
    const textToCopy = titles.join('\n'); // 将所有标题用换行符连接
    
    // 使用 Clipboard API 复制文本
    navigator.clipboard.writeText(textToCopy).then(() => {
      // 成功后，给用户一个反馈
      const originalText = copyButton.textContent;
      copyButton.textContent = '已复制！';
      setTimeout(() => {
        copyButton.textContent = originalText;
      }, 2000);
    }).catch(err => {
      console.error('无法复制文本: ', err);
      alert('复制失败，请手动选择复制。');
    });
  });
});