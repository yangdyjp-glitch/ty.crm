import { ForbiddenException, Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { TyaiIdentity } from './tyai-assertion';
import { AuthUser } from './current-user.decorator';

const identity={id:true,username:true,name:true,role:true,status:true} as const;
type DelegatedToken={sub:number;impersonatorId?:number;tyaiSid?:string};
@Injectable()
export class TyaiUsers {
  constructor(private prisma:PrismaService, private jwt:JwtService){}
  async manage(claim:TyaiIdentity|null){
    if(claim?.kind==='directory'){
      const rows=await this.prisma.user.findMany({where:{deletedAt:null},select:identity,orderBy:{username:'asc'}});
      return {accounts:rows.map(u=>({id:String(u.id),login:u.username,name:u.name,role:u.role,active:u.status==='active'}))};
    }
    if(claim?.kind!=='provision'||!Object.values(UserRole).includes(claim.role as UserRole))throw new ForbiddenException('需要平台授权');
    const role=claim.role as UserRole;
    if(claim.local){
      const id=Number(claim.local);
      const where={id,deletedAt:null,status:'active'};
      const count=claim.phase==='apply'?(await this.prisma.user.updateMany({where,data:{role}})).count:await this.prisma.user.count({where});
      if(!count)throw new NotFoundException('所选旧账号不存在或已停用');
      return {id:String(id)};
    }
    // The reserved login is deterministic so reissuing a grant cannot create a second identity.
    const username='tyai:'+claim.sub;
    const u=await this.prisma.user.upsert({where:{username},update:{},create:{username,role,
      name:claim.name!,passwordHash:await bcrypt.hash(randomBytes(32).toString('hex'),12)},select:identity});
    if(u.status!=='active')throw new ConflictException('站内账号已停用');
    return {id:String(u.id)};
  }
  async actor(claim:TyaiIdentity,authorization?:string):Promise<AuthUser>{
    if(claim.kind!=='user'||!claim.sid||!claim.local||!Object.values(UserRole).includes(claim.role as UserRole))throw new ForbiddenException('模块未授权');
    const local=await this.prisma.user.findFirst({where:{id:Number(claim.local),status:'active',deletedAt:null},select:identity});
    if(!local)throw new ForbiddenException('站内账号不可用');
    let actor:AuthUser={id:local.id,username:local.username,name:local.name,role:claim.role as UserRole};
    if(authorization?.startsWith('Bearer ')&&actor.role===UserRole.ADMIN){
      let payload:DelegatedToken|null=null;
      try{payload=await this.jwt.verifyAsync<DelegatedToken>(authorization.slice(7));}catch{}
      if(payload?.impersonatorId===actor.id&&payload.tyaiSid===claim.sid){
        const target=await this.prisma.user.findFirst({where:{id:payload.sub,status:'active',deletedAt:null},select:identity});
        if(!target)throw new ForbiddenException('代理账号已停用');
        actor={id:target.id,username:target.username,name:target.name,role:target.role,impersonatorId:local.id,impersonator:actor};
      }
    }
    Object.defineProperty(actor,'tyaiSid',{value:claim.sid});
    return actor;
  }
}
