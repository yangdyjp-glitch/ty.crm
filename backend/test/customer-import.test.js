const assert = require('node:assert/strict');
const test = require('node:test');
const Excel = require('exceljs');
const { importLayout, readLead } = require('../dist/customers/customer-import');

function sheet(rows) {
  const ws = new Excel.Workbook().addWorksheet('名单登记');
  ws.addRows(rows);
  return ws;
}

test('market sheet keeps owners, date, account, WeChat and both teams’ notes', () => {
  const ws = sheet([['名单'], ['基础信息'], ['编号', '学生姓名／平台昵称', '留资日期', '获取渠道', '来源账号/平台号', '市场负责人', '营业负责人', '微信号名称', '市场跟进记录', '营业跟进记录', '市场最后跟进日期'],
    [1, '客户甲', new Date('2026-11-11T00:00:00Z'), '小红书', '来源账号A', '市场甲', '销售乙', 'wx-123', '市场原文\n第二行', '营业原文', '2026/11/12'], [2]]);
  const layout = importLayout(ws);
  assert.equal(layout.headerRow, 3);
  const { dto, market } = readLead(ws.getRow(4), layout, false);
  assert.equal(dto.name, '客户甲');
  assert.equal(dto.discoveredAt, '2026-11-11T00:00:00.000Z');
  assert.equal(dto.wechat, 'wx-123');
  assert.match(dto.remark, /来源账号A/);
  assert.equal(market.channel, '小红书');
  assert.equal(market.marketOwner, '市场甲');
  assert.equal(market.salesOwner, '销售乙');
  assert.equal(market.followUps[0].content, '市场原文\n第二行');
  assert.equal(market.followUps[0].date.toISOString().slice(0, 10), '2026-11-12');
  assert.deepEqual(market.followUps[1], { team: '营业', author: '销售乙', content: '营业原文', date: undefined });
  assert.equal(readLead(ws.getRow(5), layout, false), undefined);
});

test('handles Excel dates and rejects invalid dates and missing lead names', () => {
  const ws = sheet([[], [], ['学生姓名/平台昵称', '留资日期', '获取渠道'], ['甲', 1, '小红书'], ['乙', '2026-02-30', '小红书'], ['', '2026-02-25', '小红书']]);
  const layout = importLayout(ws);
  assert.equal(readLead(ws.getRow(4), layout, true).dto.discoveredAt, '1904-01-02T00:00:00.000Z');
  assert.throws(() => readLead(ws.getRow(5), layout, false), /留资日期/);
  assert.throws(() => readLead(ws.getRow(6), layout, false), /缺少学生姓名/);
});

test('legacy first-row import and unrecognized headers', () => {
  const ws = sheet([['客户姓名', '手机号', '微信号', '备注'], ['甲', '123', 'wx', '原备注']]);
  const result = readLead(ws.getRow(2), importLayout(ws), false);
  assert.equal(result.market, undefined);
  assert.deepEqual([result.dto.name, result.dto.phone, result.dto.wechat, result.dto.remark], ['甲', '123', 'wx', '原备注']);
  assert.throws(() => importLayout(sheet([['标题']])), /未识别名单表头/);
});

test('separate alias and real name survive spreadsheet import', () => {
  const ws = sheet([['客户称呼', '真实姓名'], ['平台昵称', '林同学']]);
  const { dto } = readLead(ws.getRow(2), importLayout(ws), false);
  assert.equal(dto.name, '平台昵称');
  assert.equal(dto.realName, '林同学');
});
