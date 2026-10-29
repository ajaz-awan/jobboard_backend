import { writeFile } from 'node:fs/promises';
import { z } from 'zod';
import * as auth from '../src/schemas/authSchema.js';
import * as jobs from '../src/schemas/jobSchema.js';
import * as applications from '../src/schemas/applicationSchema.js';
import * as admin from '../src/schemas/adminSchema.js';
import { paginationSchema } from '../src/schemas/paginationSchema.js';
const schemas = {};
const json = schema => { const value = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }); delete value.$schema; return value; };
for (const [name, schema] of Object.entries({ Register: auth.registerSchema, SignupOtp: auth.signupOtpSchema, Login: auth.loginSchema, EmailRequest: auth.emailRequestSchema,
  ActionToken: auth.actionTokenSchema, ResetPassword: auth.resetPasswordSchema, ChangePassword: auth.changePasswordSchema, ProfileUpdate: auth.profileSchema,
  CreateJob: jobs.createJobSchema, UpdateJob: jobs.updateJobSchema, ApplicationDecision: applications.updateApplicationStatusSchema,
  UserStatus: admin.userStatusSchema, Moderation: admin.moderationSchema, ReportReview: admin.reviewReportSchema, CreateReport: admin.createReportSchema })) schemas[name] = json(schema);
schemas.Register.description = 'Employer registration also requires company_name. Passwords are limited to 72 UTF-8 bytes.';
schemas.CreateJob.description = 'Maximum salary must be at least minimum. Deadline must be future ISO/null. New jobs await moderation.';
schemas.UpdateJob.description = 'At least one field is required; merged salary range is checked and content edits resubmit review.';
schemas.Error = { type: 'object', required: ['success','message'], properties: { success: { const: false }, message: { type: 'string' }, requestId: { type: 'string' }, errors: { type: 'array', items: { type: 'object' } } } };
schemas.User = { type: 'object', properties: { id: { type:'string', format:'uuid' }, name: {type:'string'}, email:{type:'string',format:'email'}, role:{enum:['candidate','employer','admin']}, status:{enum:['active','suspended']}, email_verified:{type:'boolean'}, company_name:{type:['string','null']}, logo_url:{type:['string','null']} } };
schemas.Job = { type:'object', properties:{ id:{type:'string',format:'uuid'}, employer_id:{type:'string',format:'uuid'}, ...schemas.CreateJob.properties, moderation_status:{enum:['pending','approved','blocked']}, revision:{type:'integer',minimum:0} } };
schemas.Application = { type:'object', properties:{id:{type:'string',format:'uuid'},job_id:{type:'string',format:'uuid'},candidate_id:{type:'string',format:'uuid'},status:{enum:['pending','accepted','rejected','withdrawn']},cover_letter:{type:['string','null']}} };
const spec = { openapi:'3.1.0', info:{title:'Job Board API',version:'2.0.0',description:'MongoDB backend. Bearer access tokens plus rotating HttpOnly refresh cookie. Signup returns no access token or cookie. Email verification is required before login and all authenticated requests. Administrative mutations require a login within the last 15 minutes. See docs/authentication.md and docs/backend-release.md.'}, servers:[{url:'http://localhost:5000',description:'Local development; replace for deployed API'}], paths:{}, components:{securitySchemes:{BearerAuth:{type:'http',scheme:'bearer',bearerFormat:'JWT'},RefreshCookie:{type:'apiKey',in:'cookie',name:'jobboard_refresh',description:'Production cookie is named __Secure-jobboard_refresh; HttpOnly, SameSite=Lax, Secure in production.'}},schemas} };
const ref = name => ({$ref:`#/components/schemas/${name}`});
function add(method,path,summary,{publicRoute=false,cookie=false,body,query,multipart,status=200,binary,tags=['API'],description=''}={}) {
  const parameters=[];
  for(const match of path.matchAll(/\{([^}]+)\}/g)) parameters.push({name:match[1],in:'path',required:true,schema:match[1]==='filename'?{type:'string'}:{type:'string',format:'uuid'}});
  if(query){const q=json(query);for(const [name,schema] of Object.entries(q.properties||{})) parameters.push({name,in:'query',required:false,schema:name==='page'?{type:'integer',minimum:1,maximum:10000,default:1}:name==='limit'?{type:'integer',minimum:1,maximum:50,default:10}:name==='salary_min'?{type:'integer',minimum:0}:schema});}
  if(cookie) parameters.push({name:'X-CSRF-Protection',in:'header',required:true,schema:{type:'string',const:'1'}});
  const op={summary,description,tags,security:publicRoute?[]:cookie?[{RefreshCookie:[]}]:[{BearerAuth:[]}],responses:{[status]:{description:status===204?'No content':'Success',...(status!==204?{content:{[binary||'application/json']:{schema:binary?{type:'string',format:'binary'}:{type:'object',properties:{success:{type:'boolean'}}}}}}:{})},'400':{description:'Validation failure',content:{'application/json':{schema:ref('Error')}}},'401':{description:'Authentication/session missing or expired'},'403':{description:'Permission, verification, CSRF or recent-login requirement'},'404':{description:'Resource not found'},'409':{description:'Conflict or final state'},'429':{description:'Too many requests'},'503':{description:'Database, storage, scanner or capacity unavailable'}}};
  if(parameters.length)op.parameters=parameters;
  if(body)op.requestBody={required:true,content:{'application/json':{schema:ref(body)}}};
  if(multipart)op.requestBody={required:true,content:{'multipart/form-data':{schema:multipart}}};
  (spec.paths[path]??={})[method]=op;
}
for(const path of ['/','/health/live','/health/ready','/api/openapi.json'])add('get',path,path==='/api/openapi.json'?'OpenAPI definition':'API health',{publicRoute:true,tags:['Operations']});
for(const [path,body,summary]of[['register','Register','Create pending account; send code; no login session'],['verify-signup','SignupOtp','Consume 6-digit signup code; sign in separately'],['login','Login','Log in after email verification'],['resend-verification','EmailRequest','Request verification email'],['verify-email','ActionToken','Verify email once'],['forgot-password','EmailRequest','Request password reset'],['reset-password','ResetPassword','Reset password and revoke sessions']])add('post',`/api/auth/${path}`,summary,{body,publicRoute:true,status:path==='register'?201:200,tags:['Authentication']});
spec.paths['/api/auth/register'].post.responses['201'].content['application/json'].schema = { type: 'object', required: ['success','verification_required','email','message'], properties: { success: { const: true }, verification_required: { const: true }, email: { type: 'string', format: 'email' }, message: { type: 'string' } } };
for(const path of ['refresh','logout'])add('post',`/api/auth/${path}`,path==='refresh'?'Rotate refresh cookie and issue access token':'Revoke cookie session',{cookie:true,status:path==='logout'?204:200,tags:['Authentication']});
add('post','/api/auth/logout-all','Revoke every own session',{status:204,tags:['Authentication']});
add('post','/api/auth/change-password','Change password and revoke sessions',{body:'ChangePassword',tags:['Authentication']});
add('get','/api/auth/sessions','List up to 50 own active sessions',{tags:['Authentication']});
add('delete','/api/auth/sessions/{id}','Revoke owned session',{status:204,tags:['Authentication']});
add('get','/api/users/me','Own profile');add('patch','/api/users/me','Update name/company',{body:'ProfileUpdate'});
add('patch','/api/users/me/logo','Upload verified employer logo',{multipart:{type:'object',required:['logo'],properties:{logo:{type:'string',format:'binary'}}}});
add('get','/api/files/logos/{userId}/{filename}','Company logo',{publicRoute:true,binary:'image/*'});
add('get','/api/jobs','Published available directory',{publicRoute:true,query:jobs.jobQuerySchema,tags:['Jobs']});add('post','/api/jobs','Create employer job pending review',{body:'CreateJob',status:201,tags:['Jobs']});
for(const path of ['mine','saved'])add('get',`/api/jobs/${path}`,path==='mine'?'Employer own jobs':'Candidate bookmarks',{query:paginationSchema,tags:['Jobs']});
add('get','/api/jobs/{id}','Published job or authenticated own draft',{publicRoute:true,tags:['Jobs']});add('patch','/api/jobs/{id}','Owner edit; content changes need review',{body:'UpdateJob',tags:['Jobs']});add('delete','/api/jobs/{id}','Owner soft delete',{tags:['Jobs']});
add('put','/api/jobs/{id}/save','Bookmark job idempotently',{tags:['Jobs']});add('delete','/api/jobs/{id}/save','Remove bookmark',{status:204,tags:['Jobs']});
add('post','/api/jobs/{id}/report','Report a published job once',{body:'CreateReport',status:201,tags:['Reports']});add('get','/api/reports/my','Own reports',{query:paginationSchema,tags:['Reports']});
add('post','/api/applications','Apply with private PDF',{status:201,multipart:{type:'object',required:['job_id','resume'],properties:{job_id:{type:'string',format:'uuid'},cover_letter:{type:'string',maxLength:2000},resume:{type:'string',format:'binary'}}},tags:['Applications']});
add('get','/api/applications/my','Candidate history',{query:applications.applicationQuerySchema,tags:['Applications']});
add('get','/api/applications/job/{jobId}','Employer applicants for own job',{query:applications.applicationQuerySchema,tags:['Applications']});
add('patch','/api/applications/{id}/status','Owning employer decision',{body:'ApplicationDecision',tags:['Applications']});add('patch','/api/applications/{id}/withdraw','Withdraw own pending application',{tags:['Applications']});
add('get','/api/applications/{id}/resume','Authorized private PDF attachment',{binary:'application/pdf',tags:['Applications']});
add('get','/api/dashboard','Own candidate/employer dashboard');
add('get','/api/notifications','Own notifications',{query:admin.notificationListSchema});add('get','/api/notifications/unread-count','Own unread count');add('patch','/api/notifications/read-all','Mark own notifications read',{status:204});add('patch','/api/notifications/{id}/read','Mark one owned notification read');
add('get','/api/admin/dashboard','Administrator overview',{tags:['Admin']});
for(const[path,query,summary]of[['users',admin.userListSchema,'List accounts'],['jobs',admin.adminJobListSchema,'Review job queue'],['reports',admin.reportListSchema,'Review reports'],['audit-logs',admin.auditListSchema,'Administrative audit trail']])add('get',`/api/admin/${path}`,summary,{query,tags:['Admin'],description:'Verified administrator only.'});
for(const[path,body,summary]of[['users/{id}/status','UserStatus','Suspend/reactivate a non-admin account'],['jobs/{id}/moderation','Moderation','Approve/block the reviewed revision'],['reports/{id}','ReportReview','Resolve/dismiss an open report']])add('patch',`/api/admin/${path}`,summary,{body,tags:['Admin'],description:'Verified administrator, login within 15 minutes. Creates audit attempt before mutation.'});
await writeFile(new URL('../docs/openapi.json',import.meta.url),JSON.stringify(spec,null,2)+'\n');
console.log(`OpenAPI written: ${Object.values(spec.paths).reduce((n,p)=>n+Object.keys(p).length,0)} operations.`);
