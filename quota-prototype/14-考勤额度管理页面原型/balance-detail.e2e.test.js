const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const prototypeUrl = pathToFileURL(`${__dirname}/index.html`).href;

const expectedHeaders = [
  "",
  "姓名",
  "工号",
  "部门",
  "人员状态",
  "假期类型",
  "年度",
  "假期方案",
  "计算时间",
  "可休额度（h）",
  "已休额度（h）",
  "调整额度（h）",
  "当年标准额度（h）",
  "当年发放额度（h）",
  "当年剩余额度（h）",
  "当年有效期",
  "结转额度（h）",
  "结转剩余额度（h）",
  "结转有效期",
  "已失效额度（h）",
  "已结算额度（h）",
  "操作",
];

async function dialogLabels(page) {
  return page.locator("#dialogBody .dialog-field label").allTextContents().then((items) => items.map((item) => item.trim()));
}

async function detailRows(page) {
  return page.locator("#dialogBody .quota-detail-table tbody tr").evaluateAll((rows) =>
    rows.map((row) => [...row.children].map((cell) => cell.textContent.trim()))
  );
}

async function visibleToolbarButtonGaps(page, pageId) {
  return page.locator(`#${pageId} .card-header .toolbar`).evaluate((toolbar) => {
    const buttons = [...toolbar.querySelectorAll(":scope > button, :scope > span > button")]
      .filter((button) => getComputedStyle(button).display !== "none")
      .map((button) => button.getBoundingClientRect());
    return buttons.slice(1).map((button, index) => button.left - buttons[index].right);
  });
}

async function overflowingHeaders(page, panelId) {
  return page.locator(`#${panelId} thead th`).evaluateAll((headers) =>
    headers
      .filter((header) => header.scrollWidth > header.clientWidth)
      .map((header) => header.textContent.trim())
  );
}

(async function () {
  const browser = await chromium.launch({ headless: true, executablePath: chromePath });
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await page.goto(prototypeUrl, { waitUntil: "load" });
    await page.locator('.balance-tab[data-balance-tab="detail"]').click();

    const table = page.locator("#balance-detail .quota-table");
    assert.equal(await table.locator("thead tr").count(), 1, "余额明细只能有一层表头");
    assert.deepEqual(
      await table.locator("thead th").allTextContents().then((items) => items.map((item) => item.trim())),
      expectedHeaders,
      "余额明细字段顺序和单位应与已确认方案一致"
    );

    const forbiddenHeaders = ["计量单位", "已结转至下一年额度", "当年失效额度", "结转失效额度", "过期结算额度", "离职结算额度"];
    const headers = await table.locator("thead th").allTextContents();
    forbiddenHeaders.forEach((header) => assert.ok(!headers.includes(header), `主列表不应展示${header}`));

    const wrap = page.locator("#balance-detail .table-wrap");
    await wrap.evaluate((element) => { element.scrollLeft = 1000; });
    await page.waitForTimeout(50);
    const stickyGeometry = await page.evaluate(() => {
      const wrap = document.querySelector("#balance-detail .table-wrap");
      const headers = [...document.querySelectorAll("#balance-detail thead th")].slice(0, 3);
      const cells = [...document.querySelectorAll("#balance-detail tbody tr:first-child td")].slice(0, 3);
      const rect = (element) => {
        const box = element.getBoundingClientRect();
        return { left: box.left, right: box.right };
      };
      return {
        wrap: rect(wrap),
        paddingLeft: getComputedStyle(wrap).paddingLeft,
        headers: headers.map(rect),
        cells: cells.map(rect),
      };
    });
    assert.equal(stickyGeometry.paddingLeft, "0px", "滚动容器内边距不能露出被滚动的列");
    assert.ok(Math.abs(stickyGeometry.headers[0].left - stickyGeometry.wrap.left) < 1, "冻结列应紧贴滚动视口左侧");
    for (let index = 0; index < 3; index += 1) {
      assert.ok(Math.abs(stickyGeometry.headers[index].left - stickyGeometry.cells[index].left) < 1, `第 ${index + 1} 个冻结表头和数据列应对齐`);
    }
    assert.ok(Math.abs(stickyGeometry.headers[0].right - stickyGeometry.headers[1].left) < 1, "勾选列和姓名列不能重叠");
    assert.ok(Math.abs(stickyGeometry.headers[1].right - stickyGeometry.headers[2].left) < 1, "姓名列和工号列不能重叠");

    const annualRow = table.locator('tbody tr[data-row-type="年假"]').first();
    assert.equal(await annualRow.locator('[data-field="calculate-time"]').textContent(), "2026/08/26 02:15:30");
    assert.equal(await annualRow.locator('[data-breakdown-kind="expired"] .breakdown-total').textContent(), "6");
    assert.equal(await annualRow.locator('[data-breakdown-kind="settled"] .breakdown-total').textContent(), "3");
    assert.equal(await annualRow.locator(".breakdown-trigger").count(), 0, "失效和结算额度不再使用小眼睛");

    await annualRow.locator('[data-breakdown-kind="expired"] .breakdown-hotspot').click();
    assert.ok(await page.locator("#commonDialog").evaluate((element) => element.classList.contains("open")), "点击额度热区应打开弹窗");
    assert.equal(await page.locator("#dialogTitle").textContent(), "失效额度明细");
    assert.deepEqual(await detailRows(page), [["当年失效额度", "4"], ["结转失效额度", "2"]]);
    assert.equal(await page.locator("#dialogBody .quota-detail-table thead th").nth(1).textContent(), "额度（h）");
    await page.locator("#dialogClose").click();

    await annualRow.locator('[data-breakdown-kind="settled"] .breakdown-hotspot').click();
    assert.equal(await page.locator("#dialogTitle").textContent(), "结算额度明细");
    assert.deepEqual(await detailRows(page), [["过期结算额度", "1"], ["离职结算额度", "2"]]);
    await page.locator("#dialogClose").click();

    await annualRow.locator('.maintenance-action[data-maintenance-kind="extend"]').click();
    assert.deepEqual(await dialogLabels(page), ["假期类型", "员工", "结转有效期", "调整原因"], "年假额度延期只展示结转有效期");
    await page.locator("#dialogCancel").click();

    const sickRow = table.locator('tbody tr[data-row-type="病假"][data-year="2026"]');
    await sickRow.locator('.maintenance-action[data-maintenance-kind="extend"]').click();
    assert.deepEqual(await dialogLabels(page), ["假期类型", "员工", "当年有效期", "调整原因"], "病假额度延期展示当年有效期");
    await page.locator("#dialogCancel").click();

    const compRow = table.locator('tbody tr[data-row-type="调休假"]').first();
    await compRow.locator('.maintenance-action[data-maintenance-kind="extend"]').click();
    assert.deepEqual(await dialogLabels(page), ["假期类型", "员工", "当年有效期", "调整原因"], "调休假额度延期展示当年有效期");
    await page.locator("#dialogCancel").click();

    await annualRow.locator('input[type="checkbox"]').check();
    await page.locator("#balance-detail .toolbar-trigger", { hasText: "批量操作" }).click();
    await page.locator('#balance-detail .batch-maintenance-action[data-maintenance-kind="extend"]').click();
    assert.deepEqual(await dialogLabels(page), ["假期类型", "结转有效期", "调整原因"], "批量延期应与年假单条延期字段一致");
    await page.locator("#dialogCancel").click();
    await annualRow.locator('input[type="checkbox"]').uncheck();

    await sickRow.locator('input[type="checkbox"]').check();
    await page.locator("#balance-detail .toolbar-trigger", { hasText: "批量操作" }).click();
    await page.locator('#balance-detail .batch-maintenance-action[data-maintenance-kind="extend"]').click();
    assert.deepEqual(await dialogLabels(page), ["假期类型", "当年有效期", "调整原因"], "病假批量延期应展示当年有效期");
    await page.locator("#dialogCancel").click();
    await sickRow.locator('input[type="checkbox"]').uncheck();

    await page.locator('#balance-detail .toolbar-trigger', { hasText: '计算额度' }).click();
    await page.locator('#balance-detail .calculate-action[data-calc-kind="annual"]').click();
    const calculateAreaField = page.locator('#dialogBody .dialog-row').filter({ has: page.locator('label', { hasText: '划分区域' }) });
    assert.equal(
      await calculateAreaField.locator('option').nth(1).textContent(),
      "FBU-美东区",
      "计算额度弹窗的划分区域案例也应使用 FBU-美东区"
    );
    await page.locator('#dialogCancel').click();

    await page.locator('.balance-tab[data-balance-tab="usage"]').click();
    const usage = page.locator("#balance-usage");
    assert.equal(await usage.locator("thead th").nth(8).textContent(), "已休额度（h）");
    assert.equal(await usage.locator("thead th").nth(9).textContent(), "使用明细");
    assert.equal(await usage.locator("tbody tr").first().locator(".split-action").textContent(), "查看使用明细");
    assert.deepEqual(
      await usage.locator("tbody tr").first().locator(".split-summary div").allTextContents(),
      ["2025｜结转额度｜8h", "2026｜当年发放额度｜8h"],
      "年假额度使用明细应按年度、额度组成、使用额度拼接"
    );
    assert.equal(await usage.locator('tbody tr[data-usage-type="调休假"] .split-summary').textContent(), "2026-07-12加班｜4h", "调休假应明确展示额度对应的加班日期");
    assert.equal(await usage.locator("tbody tr").first().locator("td").nth(8).textContent(), "16", "单位进入表头后单元格只显示数值");

    const usageWrap = usage.locator(".card > .table-wrap");
    await usageWrap.evaluate((element) => { element.scrollLeft = 900; });
    await page.waitForTimeout(50);
    const usageGeometry = await page.evaluate(() => {
      const wrap = document.querySelector("#balance-usage .card > .table-wrap");
      const table = wrap.querySelector("table");
      const headers = [...table.querySelectorAll("thead th")];
      const cells = [...table.querySelectorAll("tbody tr:first-child td")];
      const rect = (element) => {
        const box = element.getBoundingClientRect();
        return { left: box.left, right: box.right, width: box.width };
      };
      return {
        wrap: rect(wrap),
        paddingLeft: getComputedStyle(wrap).paddingLeft,
        tableLayout: getComputedStyle(table).tableLayout,
        tableWidth: rect(table).width,
        headers: headers.map(rect),
        cells: cells.map(rect),
      };
    });
    assert.equal(usageGeometry.paddingLeft, "0px", "已休明细滚动容器不能露出被滚动的列");
    assert.equal(usageGeometry.tableLayout, "fixed", "已休明细应固定列宽，避免内容把列间距撑大");
    assert.ok(usageGeometry.tableWidth <= 1680, "已休明细整表宽度应收敛，避免列间距过大");
    assert.ok(Math.abs(usageGeometry.headers[0].left - usageGeometry.wrap.left) < 1, "已休明细冻结列应紧贴滚动视口左侧");
    for (let index = 0; index < 3; index += 1) {
      assert.ok(Math.abs(usageGeometry.headers[index].left - usageGeometry.cells[index].left) < 1, `已休明细第 ${index + 1} 个冻结表头和数据列应对齐`);
    }
    assert.ok(Math.abs(usageGeometry.headers[0].right - usageGeometry.headers[1].left) < 1, "已休明细序号列和姓名列不能重叠");
    assert.ok(Math.abs(usageGeometry.headers[1].right - usageGeometry.headers[2].left) < 1, "已休明细姓名列和工号列不能重叠");

    await usage.locator("tbody tr").first().locator(".split-action").click();
    assert.equal(await page.locator("#dialogTitle").textContent(), "使用明细");
    assert.deepEqual(
      await page.locator("#dialogBody thead th").allTextContents(),
      ["休假日期", "休假时段", "扣减休息时长（h）", "年度", "额度组成", "额度有效期", "使用额度（h）"]
    );
    assert.equal(await page.locator("#dialogBody tbody tr").nth(1).locator("td").nth(4).textContent(), "当年发放额度");
    await page.locator("#dialogClose").click();

    await usage.locator('tbody tr[data-usage-type="调休假"] .split-action').click();
    assert.equal(await page.locator("#dialogTitle").textContent(), "使用明细");
    const compHeaders = await page.locator("#dialogBody thead th").allTextContents();
    assert.ok(compHeaders.includes("加班日期"), "调休假使用明细应展示员工可理解的加班日期");
    assert.ok(!compHeaders.includes("考勤日期"), "调休假使用明细不应使用含义不清的考勤日期");
    await page.locator("#dialogClose").click();

    await page.locator('.balance-tab[data-balance-tab="summary"]').click();
    assert.deepEqual(
      await page.locator("#balance-summary thead th").allTextContents().then((items) => items.slice(-4)),
      ["总可休额度（h）", "年假可休额度（h）", "病假可休额度（h）", "调休假可休额度（h）"]
    );
    assert.deepEqual(
      await page.locator("#balance-summary tbody tr").first().locator("td").allTextContents().then((items) => items.slice(-4)),
      ["128", "72", "40", "16"]
    );

    await page.locator('.menu-item[data-page="annual-settlement"]').click();
    const annualToolbarGaps = await visibleToolbarButtonGaps(page, "page-annual-settlement");
    assert.ok(annualToolbarGaps.every((gap) => gap >= 6), "年假结算的业务按钮和导出按钮之间都应保留可见间距");

    await page.locator('.menu-item[data-page="comp-settlement"]').click();
    const compToolbarGaps = await visibleToolbarButtonGaps(page, "page-comp-settlement");
    assert.ok(compToolbarGaps.every((gap) => gap >= 6), "调休假结算的业务按钮和导出按钮之间都应保留可见间距");

    const teamMenu = page.locator('.menu-item[data-page="team-balance"]');
    const selfMenu = page.locator('.menu-item[data-page="my-balance"]');
    assert.equal(await teamMenu.count(), 1, "团队假期下应新增团队假期余额入口");
    assert.equal(await selfMenu.count(), 1, "我的假勤下应新增我的假期余额入口");
    assert.equal(await teamMenu.textContent(), "团队假期余额", "团队假期下应新增团队假期余额入口");
    assert.equal(await selfMenu.textContent(), "我的假期余额", "我的假勤下应新增我的假期余额入口");

    await page.setViewportSize({ width: 1050, height: 850 });
    await teamMenu.click();
    assert.equal(await page.locator(".breadcrumb").innerText(), "考勤管理 / 团队假期 / 团队假期余额");
    assert.deepEqual(
      await page.locator('#page-team-balance .audience-balance-tab').allTextContents(),
      ["余额汇总", "余额明细", "已休明细"],
      "团队页应包含三个只读页签"
    );
    assert.deepEqual(
      await page.locator('#team-balance-summary .search-item label').allTextContents(),
      ["划分区域", "部门", "员工", "人员状态"]
    );
    assert.equal(await page.locator('#team-balance-summary .search-item :is(input,select):disabled').count(), 0, "团队查询条件均应可用");
    assert.deepEqual(
      await page.locator('#team-balance-summary .card-header .toolbar button').allTextContents(),
      ["导出", "导出设置"]
    );
    assert.deepEqual(
      await page.locator('#team-balance-summary thead th').allTextContents(),
      ["序号", "员工", "工号", "部门", "人员状态", "总可休额度（h）", "年假可休额度（h）", "病假可休额度（h）", "调休假可休额度（h）"],
      "团队汇总应展示总可休额度和三类可休额度"
    );
    const teamSummaryVisibility = await page.locator('#team-balance-summary').evaluate((panel) => {
      const wrap = panel.querySelector('.table-wrap').getBoundingClientRect();
      const headers = [...panel.querySelectorAll('thead th')];
      const total = headers.find((header) => header.textContent.trim() === '总可休额度（h）').getBoundingClientRect();
      return { wrapRight: wrap.right, totalRight: total.right };
    });
    assert.ok(teamSummaryVisibility.totalRight <= teamSummaryVisibility.wrapRight + 1, "团队汇总首屏应直接看到总可休额度");
    await page.setViewportSize({ width: 2786, height: 850 });
    const teamSummaryWideFill = await page.locator('#team-balance-summary').evaluate((panel) => {
      const wrap = panel.querySelector('.table-wrap').getBoundingClientRect();
      const table = panel.querySelector('table').getBoundingClientRect();
      return { wrapRight: wrap.right, tableRight: table.right };
    });
    assert.ok(Math.abs(teamSummaryWideFill.wrapRight - teamSummaryWideFill.tableRight) < 1, "团队汇总在宽屏下应铺满表格容器");
    await page.setViewportSize({ width: 1050, height: 850 });
    assert.equal(
      await page.locator('#team-balance-summary [data-query-key="area"] option').nth(1).textContent(),
      "FBU-美东区",
      "团队页划分区域案例应使用 FBU-美东区"
    );

    await page.locator('#team-balance-summary [data-audience-drill="detail"][data-leave-type="年假"]').first().click();
    assert.ok(await page.locator('#team-balance-detail').evaluate((element) => element.classList.contains("active")), "团队汇总额度可下钻余额明细");
    assert.equal(await page.locator('#team-balance-detail [data-query-key="employee"]').inputValue(), "张三");
    assert.equal(await page.locator('#team-balance-detail [data-query-key="leave-type"]').inputValue(), "年假");
    const teamDetailHeaders = await page.locator('#team-balance-detail thead th').allTextContents();
    assert.deepEqual(
      teamDetailHeaders,
      ["姓名", "工号", "部门", "人员状态", "假期类型", "年度", "可休额度（h）", "已休额度（h）", "调整额度（h）", "当年发放额度（h）", "当年剩余额度（h）", "当年有效期", "结转额度（h）", "结转剩余额度（h）", "结转有效期"],
      "团队余额明细只展示可理解的额度结果字段"
    );
    assert.deepEqual(await overflowingHeaders(page, 'team-balance-detail'), [], "团队余额明细表头不能溢出到相邻列");
    assert.ok((await page.locator('#team-balance-detail table').boundingBox()).width <= 1700, "团队明细删减字段后应同步收敛整表宽度");
    assert.equal(await page.locator('#team-balance-detail :is(.maintenance-action,.batch-maintenance-action,.calculate-action,.import-action)').count(), 0);

    await page.locator('#team-balance-detail .audience-used-quota-link').first().click();
    assert.ok(await page.locator('#team-balance-usage').evaluate((element) => element.classList.contains("active")), "团队已休额度可下钻已休明细");
    assert.equal(await page.locator('#team-balance-usage [data-query-key="employee"]').inputValue(), "张三");
    assert.equal(await page.locator('#team-balance-usage [data-query-key="leave-type"]').inputValue(), "年假");
    assert.equal(await page.locator('#team-balance-usage a', { hasText: "查看使用明细" }).first().textContent(), "查看使用明细");
    await page.locator('#team-balance-usage .search-actions .btn:not(.primary)').click();
    const teamUsageRecordLayout = await page.locator('#team-balance-usage').evaluate((panel) => {
      const wrap = panel.querySelector('.table-wrap');
      const table = panel.querySelector('table');
      wrap.scrollLeft = wrap.scrollWidth;
      const headers = [...table.querySelectorAll('th')].map((header) => header.textContent.trim());
      const recordIndex = headers.indexOf('休假记录');
      const row = [...table.querySelectorAll('tbody tr')].find((item) => item.textContent.includes('变更单'));
      const recordCell = row.children[recordIndex];
      const operationCell = row.children[recordIndex + 1];
      return {
        recordClientWidth: recordCell.clientWidth,
        recordScrollWidth: recordCell.scrollWidth,
        recordRight: recordCell.getBoundingClientRect().right,
        operationLeft: operationCell.getBoundingClientRect().left,
      };
    });
    assert.ok(teamUsageRecordLayout.recordScrollWidth <= teamUsageRecordLayout.recordClientWidth, "多条休假记录不能溢出本列");
    assert.ok(Math.abs(teamUsageRecordLayout.recordRight - teamUsageRecordLayout.operationLeft) < 1, "休假记录列和操作列不能错位");

    await selfMenu.click();
    assert.equal(await page.locator(".breadcrumb").innerText(), "考勤管理 / 我的假勤 / 我的假期余额");
    assert.deepEqual(
      await page.locator('#page-my-balance .audience-balance-tab').allTextContents(),
      ["余额汇总", "余额明细", "已休明细"],
      "个人页应包含三个只读页签"
    );
    assert.equal(await page.locator('#my-balance-summary .search-item :is(input,select):disabled').count(), 4, "个人汇总固定本人查询条件");
    const mySummaryHeaders = await page.locator('#my-balance-summary thead th').allTextContents();
    assert.deepEqual(
      mySummaryHeaders,
      ["总可休额度（h）", "年假可休额度（h）", "病假可休额度（h）", "调休假可休额度（h）"],
      "个人汇总应展示本人总可休额度和三类可休额度"
    );
    assert.equal(
      await page.locator('#my-balance-summary [data-query-key="area"]').inputValue(),
      "FBU-美东区",
      "个人页固定划分区域应使用 FBU-美东区"
    );

    await page.locator('#my-balance-summary [data-audience-drill="detail"][data-leave-type="年假"]').click();
    assert.ok(await page.locator('#my-balance-detail').evaluate((element) => element.classList.contains("active")), "个人汇总额度可下钻余额明细");
    assert.equal(await page.locator('#my-balance-detail [data-query-key="leave-type"]').inputValue(), "年假");
    await page.locator('#my-balance-detail .audience-used-quota-link').first().click();
    assert.ok(await page.locator('#my-balance-usage').evaluate((element) => element.classList.contains("active")), "个人已休额度可下钻已休明细");
    assert.equal(await page.locator('#my-balance-usage [data-query-key="leave-type"]').inputValue(), "年假");

    await page.locator('#page-my-balance .audience-balance-tab[data-audience-tab="detail"]').click();
    await page.locator('#my-balance-detail .search-actions .btn:not(.primary)').click();
    assert.deepEqual(
      await page.locator('#my-balance-detail .search-item label').allTextContents(),
      ["划分区域", "部门", "员工", "人员状态", "假期类型", "年度", "余额状态"]
    );
    assert.equal(await page.locator('#my-balance-detail .search-item :is(input,select):disabled').count(), 4);
    assert.equal(await page.locator('#my-balance-detail [data-query-key="balance-status"]').inputValue(), "有可休额度");
    assert.equal(await page.locator('#my-balance-detail tbody tr:visible').count(), 3, "个人明细默认只展示可休额度大于0的记录");
    const myDetailHeaders = await page.locator('#my-balance-detail thead th').allTextContents();
    assert.deepEqual(
      myDetailHeaders,
      ["假期类型", "年度", "可休额度（h）", "已休额度（h）", "调整额度（h）", "当年发放额度（h）", "当年剩余额度（h）", "当年有效期", "结转额度（h）", "结转剩余额度（h）", "结转有效期"],
      "个人余额明细与团队页共用同一套额度结果字段"
    );
    assert.deepEqual(await overflowingHeaders(page, 'my-balance-detail'), [], "个人余额明细表头不能溢出到相邻列");
    assert.ok((await page.locator('#my-balance-detail table').boundingBox()).width <= 1340, "个人明细删减字段后应同步收敛整表宽度");
    await page.setViewportSize({ width: 1600, height: 850 });
    const myDetailFill = await page.locator('#my-balance-detail').evaluate((panel) => {
      const wrap = panel.querySelector('.table-wrap').getBoundingClientRect();
      const table = panel.querySelector('table').getBoundingClientRect();
      return { wrapRight: wrap.right, tableRight: table.right };
    });
    assert.ok(Math.abs(myDetailFill.wrapRight - myDetailFill.tableRight) < 1, "个人余额明细在宽屏下应完整铺满表格容器");

    await page.locator('#my-balance-detail [data-query-key="balance-status"]').selectOption("全部");
    await page.locator('#my-balance-detail .search-actions .btn.primary').click();
    assert.equal(await page.locator('#my-balance-detail tbody tr:visible').count(), 4, "余额状态切换全部后展示历史记录");
    await page.locator('#my-balance-detail .search-actions .btn:not(.primary)').click();
    assert.equal(await page.locator('#my-balance-detail [data-query-key="balance-status"]').inputValue(), "有可休额度");
    assert.equal(await page.locator('#my-balance-detail tbody tr:visible').count(), 3, "重置后恢复有可休额度默认条件");

    await page.locator('#page-my-balance .audience-balance-tab[data-audience-tab="usage"]').click();
    assert.deepEqual(
      await page.locator('#my-balance-usage .search-item label').allTextContents(),
      ["划分区域", "部门", "员工", "人员状态", "假期类型", "休假日期"]
    );
    assert.equal(await page.locator('#my-balance-usage .search-item :is(input,select):disabled').count(), 4);
    const myUsageHeaders = await page.locator('#my-balance-usage thead th').allTextContents();
    ["姓名", "工号", "部门", "人员状态"].forEach((header) => assert.ok(!myUsageHeaders.includes(header), `个人已休明细不展示${header}`));
    assert.equal(await page.locator('#page-my-balance :is(.maintenance-action,.batch-maintenance-action,.calculate-action,.import-action)').count(), 0, "个人页不能出现额度维护入口");

    const allHeaders = await page.locator("table thead th").allTextContents();
    assert.ok(!allHeaders.some((header) => /\((?:小时|H)\)/.test(header)), "列表单位统一使用中文括号和小写 h");
    assert.deepEqual(pageErrors, [], "页面脚本不应产生运行时错误");
    console.log("balance detail e2e: passed");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
