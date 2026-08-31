const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const prototypeUrl = pathToFileURL(`${__dirname}/index.html`).href;

async function labels(page) {
  return page.locator("#dialogBody .dialog-field > label").allTextContents().then((items) => items.map((item) => item.trim()));
}

async function openPage(page, name) {
  await page.locator(`.menu-item[data-page="${name}"]`).click();
}

async function closeDialog(page) {
  await page.locator("#dialogCancel:visible, #dialogClose:visible").first().click();
}

(async function () {
  const browser = await chromium.launch({ headless: true, executablePath: chromePath });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await page.goto(prototypeUrl, { waitUntil: "load" });

    await openPage(page, "annual-settlement");
    const annualEmployeeQuery = page.locator('#page-annual-settlement .search-item input[placeholder*="姓名"]').first();
    await annualEmployeeQuery.fill("张三");
    await page.locator('#page-annual-settlement .search-actions .btn', { hasText: "重置" }).click();
    assert.equal(await annualEmployeeQuery.inputValue(), "", "年假结算重置应清空输入条件");
    await page.locator('#page-annual-settlement .search-actions .btn', { hasText: "查询" }).click();
    assert.equal(await page.locator("#toast").textContent(), "已按当前条件查询年假结算");
    await page.locator('#page-annual-settlement .toolbar .btn', { hasText: "导出设置" }).click();
    assert.equal(await page.locator("#dialogTitle").textContent(), "年假结算导出设置");
    assert.ok(await page.locator('#dialogBody input[type="checkbox"]:checked').count() > 0, "导出设置应展示可选字段");
    assert.equal(await page.locator("#dialogOk").textContent(), "保存");
    await page.locator("#dialogOk").click();
    assert.equal(await page.locator("#toast").textContent(), "导出字段设置已保存");
    await page.locator('#page-annual-settlement .toolbar .export-btn').click();
    assert.equal(await page.locator("#toast").textContent(), "年假结算导出任务已提交");
    await page.locator(".annual-action .btn", { hasText: "过期结算" }).click();
    assert.equal(await page.locator("#dialogTitle").textContent(), "过期结算");
    assert.deepEqual(await labels(page), ["年度", "划分区域", "结算额度所属日期", "结算范围", "员工"]);
    const annualYear = page.locator('#dialogBody [data-field="annual-years"]');
    assert.equal(await annualYear.evaluate((element) => element.tagName), "SELECT", "过期结算年度应使用可选控件");
    assert.ok(await annualYear.locator("option").count() >= 2, "年度选择器应提供可切换选项");
    const annualBelongDatePicker = page.locator('#dialogBody [data-field="settlement-belong-date"]');
    assert.equal(await annualBelongDatePicker.getAttribute("type"), "date", "过期结算所属日期应使用日期控件");
    await annualBelongDatePicker.fill("2026-09-30");
    assert.equal(await annualBelongDatePicker.inputValue(), "2026-09-30");
    assert.equal(await page.locator('#dialogBody [name="annual-settlement-scope"]:checked').getAttribute("value"), "employee");
    await page.locator('#dialogBody [name="annual-settlement-scope"][value="organization"]').check();
    assert.deepEqual(await labels(page), ["年度", "划分区域", "结算额度所属日期", "结算范围", "组织"]);
    await closeDialog(page);

    await page.locator(".annual-action .btn", { hasText: "离职结算" }).click();
    assert.equal(await page.locator("#dialogTitle").textContent(), "离职结算");
    assert.deepEqual(await labels(page), ["划分区域", "结算额度所属日期", "结算范围", "员工"]);
    const annualBelongDate = page.locator('#dialogBody [data-field="settlement-belong-date"]');
    assert.equal(await annualBelongDate.isDisabled(), true);
    assert.equal(await annualBelongDate.inputValue(), "系统自动取离职日期");
    await closeDialog(page);

    await page.locator("#annual-settle-summary tbody input[type=checkbox]").first().check();
    await page.locator(".annual-action .btn", { hasText: "撤销结算" }).click();
    assert.equal(await page.locator("#dialogTitle").textContent(), "撤销年假结算");
    assert.match(await page.locator("#dialogBody").innerText(), /已选 1 条/);
    assert.match(await page.locator("#dialogBody").innerText(), /重新计算可休额度/);
    await page.locator("#dialogOk").click();
    assert.equal(await page.locator("#dialogTitle").textContent(), "操作成功");
    assert.match(await page.locator("#dialogBody").innerText(), /消息中心/);
    await closeDialog(page);

    await page.locator('#annual-settle-summary .settle-drill[data-settle-page="annual"]').first().click();
    assert.ok(await page.locator("#annual-settle-detail").evaluate((element) => element.classList.contains("active")), "年假汇总应下钻结算明细");
    assert.equal(await page.locator('#page-annual-settlement .search-item input[placeholder*="姓名"]').first().inputValue(), "张三", "年假下钻应回填员工");
    assert.equal(await page.locator('#page-annual-settlement .search-item select').filter({ has: page.locator('option:text-is("过期结算")') }).inputValue(), "过期结算", "年假下钻应回填结算类型");
    await page.locator('.settle-tab[data-settle-page="annual"][data-settle-tab="summary"]').click();
    await page.locator("#annual-settle-summary .settlement-log-action").click();
    assert.equal(await page.locator("#dialogTitle").textContent(), "年假结算日志");
    assert.deepEqual(await page.locator("#dialogBody table thead th").allTextContents(), ["操作类型", "操作人", "操作时间"]);
    const logInputs = page.locator("#dialogBody .settlement-log-query input");
    await logInputs.nth(0).fill("2026/08/01 - 2026/08/31");
    await logInputs.nth(1).fill("admin");
    await page.locator("#dialogBody .settlement-log-query .btn", { hasText: "重置" }).click();
    assert.deepEqual(await logInputs.evaluateAll((items) => items.map((item) => item.value)), ["", ""], "日志重置应清空条件");
    await page.locator("#dialogBody .settlement-log-query .btn", { hasText: "查询" }).click();
    assert.equal(await page.locator("#toast").textContent(), "已按当前条件查询结算日志");
    await closeDialog(page);

    await openPage(page, "comp-settlement");
    await page.locator(".comp-action .btn", { hasText: "余额结算" }).click();
    assert.equal(await page.locator("#dialogTitle").textContent(), "余额结算");
    assert.deepEqual(await labels(page), ["考勤周期", "考勤时间段", "结算范围", "员工"]);
    await page.locator('#dialogBody [name="comp-settlement-scope"][value="organization"]').check();
    assert.deepEqual(await labels(page), ["考勤周期", "考勤时间段", "结算范围", "组织"]);
    await closeDialog(page);

    await page.locator(".comp-action .btn", { hasText: "离职结算" }).click();
    assert.equal(await page.locator("#dialogTitle").textContent(), "离职结算");
    assert.deepEqual(await labels(page), ["员工"]);
    await closeDialog(page);

    await page.locator("#comp-settle-summary tbody input[type=checkbox]").first().check();
    await page.locator(".comp-action .btn", { hasText: "撤销结算" }).click();
    assert.equal(await page.locator("#dialogTitle").textContent(), "撤销调休假结算");
    assert.deepEqual(
      await page.locator("#dialogBody .settlement-verify-grid strong").allTextContents(),
      ["1", "1", "0", "0"],
      "调休撤销应展示总数、可撤销、已撤销和已封存数"
    );
    await closeDialog(page);
    await page.locator("#comp-settle-summary .settlement-log-action").click();
    assert.equal(await page.locator("#dialogTitle").textContent(), "调休假结算日志");
    await closeDialog(page);
    await page.locator('#comp-settle-summary .settle-drill[data-settle-page="comp"]').first().click();
    assert.equal(await page.locator('#page-comp-settlement .search-item input[placeholder*="姓名"]').first().inputValue(), "张三", "调休下钻应回填员工");
    assert.equal(await page.locator('#page-comp-settlement .comp-settle-detail input').inputValue(), "2026/07/01 - 2026/07/31", "调休下钻应回填考勤日期范围");

    await openPage(page, "sick-settlement");
    assert.equal(await page.locator("#page-sick-settlement thead th").evaluateAll((items) => items.filter((item) => item.textContent.trim() === "操作").length), 0, "病假结算不应展示操作列");
    assert.equal(await page.locator("#page-sick-settlement tbody .row-actions").count(), 0, "病假结算不应展示年度汇总和日志行操作");
    const sickLeaveButton = page.locator("#page-sick-settlement .toolbar .btn", { hasText: "离职结算" });
    await sickLeaveButton.click();
    assert.equal(await page.locator("#toast").textContent(), "请先勾选数据");
    await page.locator("#page-sick-settlement tbody input[type=checkbox]").first().check();
    await sickLeaveButton.click();
    assert.equal(await page.locator("#dialogTitle").textContent(), "病假离职结算确认");
    assert.match(await page.locator("#dialogBody").innerText(), /存在审批中的病假或销假单/);
    assert.doesNotMatch(await page.locator("#dialogBody").innerText(), /在途/, "页面不向用户展示在途这个内部术语");
    assert.equal(await page.locator("#dialogCancel").textContent(), "暂不结算");
    assert.equal(await page.locator("#dialogOk").textContent(), "仍要结算");
    await page.locator("#dialogOk").click();
    assert.equal(await page.locator("#dialogTitle").textContent(), "操作成功");
    assert.match(await page.locator("#dialogBody").innerText(), /消息中心/);
    await closeDialog(page);

    await page.locator("#page-sick-settlement .toolbar .btn", { hasText: "撤销结算" }).click();
    assert.equal(await page.locator("#dialogTitle").textContent(), "撤销病假结算");
    assert.match(await page.locator("#dialogBody").innerText(), /恢复可休额度/);
    await closeDialog(page);

    assert.deepEqual(pageErrors, [], "结算交互不应产生页面运行时错误");
    console.log("settlement interactions e2e: passed");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
