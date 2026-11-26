import { BadRequestException } from '@nestjs/common';
import { SourceCategory } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { CreateCustomerDto } from './dto/customer.dto';

export interface ImportedFollowUp {
  team: '市场' | '营业';
  author?: string;
  date?: Date;
  content: string;
}

export interface MarketLead {
  channel: string;
  marketOwner?: string;
  salesOwner?: string;
  followUps: ImportedFollowUp[];
}

function valueText(value: ExcelJS.CellValue): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'object') return String(value).trim() || undefined;
  if ('text' in value) return value.text.trim() || undefined;
  if ('richText' in value) return value.richText.map((part) => part.text).join('').trim() || undefined;
  if ('result' in value) return valueText(value.result);
  return undefined;
}

function readDate(cell: ExcelJS.Cell | undefined, date1904: boolean, label: string) {
  let value = cell?.value;
  if (value && typeof value === 'object' && 'result' in value) value = value.result;
  if (value == null || value === '') return undefined;
  let date: Date;
  if (value instanceof Date) {
    date = value;
  } else if (typeof value === 'number' && value > 0) {
    date = new Date(Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : 30) + Math.floor(value) * 86400000);
  } else {
    const parts = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/.exec(valueText(value) ?? '');
    if (!parts) throw new BadRequestException(label + '格式无效');
    const [, year, month, day] = parts.map(Number);
    date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new BadRequestException(label + '无效');
  }
  if (!Number.isFinite(date.getTime())) throw new BadRequestException(label + '无效');
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function importLayout(sheet: ExcelJS.Worksheet) {
  for (const headerRow of [1, 3]) {
    const columns = new Map<string, number>();
    sheet.getRow(headerRow).eachCell((cell, col) => {
      const title = valueText(cell.value)?.normalize('NFKC');
      if (title) columns.set(title, col);
    });
    const market = columns.has('学生姓名/平台昵称');
    if (market || columns.has('客户称呼') || columns.has('姓名') || columns.has('客户姓名')) return { headerRow, columns, market };
  }
  throw new BadRequestException('未识别名单表头，请检查第1行或第3行的姓名列');
}

export function readLead(row: ExcelJS.Row, layout: ReturnType<typeof importLayout>, date1904: boolean):
  { dto: CreateCustomerDto; market?: MarketLead } | undefined {
  const cell = (title: string) => {
    const col = layout.columns.get(title);
    return col ? row.getCell(col) : undefined;
  };
  const text = (...titles: string[]) => titles.map(title => valueText(cell(title)?.value)).find(Boolean);
  const name = text('学生姓名/平台昵称', '客户称呼', '姓名', '客户姓名');
  if (!name) {
    if (layout.market && [...layout.columns.keys()].some(title => title !== '编号' && cell(title)?.value != null && cell(title)?.text.trim())) {
      throw new BadRequestException('缺少学生姓名/平台昵称');
    }
    return;
  }
  const dto: CreateCustomerDto = {
    name, phone: text('电话', '手机号'), wechat: text('微信号名称', '微信', '微信号'),
    realName: text('真实姓名'),
    email: text('邮箱'), sourceCategory: SourceCategory.SELF, remark: text('备注'),
  };
  if (!layout.market) return { dto };
  const channel = text('获取渠道');
  if (!channel) throw new BadRequestException('缺少获取渠道');
  const discoveredAt = readDate(cell('留资日期'), date1904, '留资日期');
  if (!discoveredAt) throw new BadRequestException('缺少留资日期');
  dto.discoveredAt = discoveredAt.toISOString();
  const marketOwner = text('市场负责人');
  const salesOwner = text('营业负责人');
  const followUps: ImportedFollowUp[] = [];
  const notes = dto.remark ? [dto.remark] : [];
  for (const title of ['来源账号/平台号', '名单属地', '咨询方向/意向服务', '是否要到微信号', '营业确认状态', '是否添加微信号', '是否完成评估']) {
    const value = text(title);
    if (value) notes.push(title + '：' + value);
  }
  const added = readDate(cell('微信添加日期'), date1904, '微信添加日期');
  if (added) notes.push('微信添加日期：' + added.toISOString().slice(0, 10));
  for (const team of ['市场', '营业'] as const) {
    const content = text(team + '跟进记录');
    const dateLabel = team + '最后跟进日期';
    const date = readDate(cell(dateLabel), date1904, dateLabel);
    if (content) followUps.push({ team, content, date, author: team === '市场' ? marketOwner : salesOwner });
    else if (date) notes.push(dateLabel + '：' + date.toISOString().slice(0, 10));
  }
  dto.remark = notes.join('\n') || undefined;
  return { dto, market: { channel, marketOwner, salesOwner, followUps } };
}
