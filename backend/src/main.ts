import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import compression from 'compression';
import { AppModule } from './app.module';
import type { Request, Response, NextFunction } from 'express';
import { TyaiUsers } from './auth/tyai';
import { readTyai } from './auth/tyai-assertion';
import type { AuthUser } from './auth/current-user.decorator';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  const identities=app.get(TyaiUsers);
  app.use(async (req:Request & {tyaiUser?:AuthUser},res:Response,next:NextFunction)=>{
    try{
      const claim=readTyai(req.headers['x-tyai-identity'],'crm',req.method,req.originalUrl);
      if(req.path==='/api/tyai/identities'){res.json(await identities.manage(claim));return;}
      if(claim){
        if(req.path==='/api/auth/login'||(/^\/api\/users(?:\/|$)/.test(req.path)&&!['GET','HEAD'].includes(req.method))){
          res.status(403).json({message:'请在 TYAI 管理账号'});return;
        }
        req.tyaiUser=await identities.actor(claim,req.headers.authorization);
      }else if(process.env.TYAI_ONLY==='1'&&req.path!=='/api/health'){
        res.status(401).json({message:'请通过 TYAI 登录'});return;
      }
      next();
    }catch(error){
      const e=error as Error&{status?:number;getStatus?:()=>number};
      const status=e.getStatus?.()||e.status||500;
      res.status(status).json({message:status===500?'账号服务暂不可用':e.message});
    }
  });
  app.use(compression({ threshold: 1024 }));
  app.enableCors({ origin: true, credentials: true, maxAge: 600 });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );
  const port = process.env.PORT ?? 3001;
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`CRM backend running on http://localhost:${port}/api`);
}
bootstrap();
