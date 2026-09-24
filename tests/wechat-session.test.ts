import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const h = vi.hoisted(() => ({
  getUser: vi.fn(), getClaims: vi.fn(), assurance: vi.fn(), password: vi.fn(), signOut: vi.fn(),
  login: vi.fn(), link: vi.fn(), cookie: vi.fn(), rate: vi.fn(), ticket: vi.fn(), origin:'https://app.example.com',
}));
vi.mock('next/headers',()=>({cookies:async()=>({set:h.cookie}),headers:async()=>new Headers({origin:h.origin})}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:h.getUser,getClaims:h.getClaims,mfa:{getAuthenticatorAssuranceLevel:h.assurance},signInWithOAuth:h.login,linkIdentity:h.link}})}));
vi.mock('@supabase/supabase-js',()=>({createClient:()=>({auth:{signInWithPassword:h.password,signOut:h.signOut}})}));
vi.mock('@/lib/supabase/config',()=>({getSupabaseConfig:()=>({url:'https://auth.example.com',key:'fixture-key'})}));
vi.mock('@/lib/supabase/server-transport',()=>({createSupabaseServerFetch:vi.fn()}));
vi.mock('@/features/wechat/config',()=>({requireWechatConfig:()=>({siteOrigin:'https://app.example.com',authCallbackUrl:'https://auth.example.com/auth/v1/callback'})}));
vi.mock('@/features/wechat/store',()=>({issueTicket:h.ticket}));
vi.mock('@/features/wechat/rate-limit',()=>({checkWechatRateLimit:h.rate}));
import { assertWechatFlowSession, beginWechatFlow, currentWechatAuthContext, verifyWechatLinkPassword } from '@/features/wechat/session';

const userId='11111111-1111-4111-8111-111111111111', sessionId='22222222-2222-4222-8222-222222222222';
const flow={mode:'link' as const,locale:'zh' as const,next:'/zh/dashboard',userId,sessionId};
beforeEach(()=>{
  vi.clearAllMocks();h.origin='https://app.example.com';
  h.getUser.mockResolvedValue({data:{user:{id:userId}},error:null});
  h.getClaims.mockResolvedValue({data:{claims:{sub:userId,session_id:sessionId}},error:null});
  h.password.mockResolvedValue({data:{user:{id:userId},session:{access_token:'fixture'}},error:null});
  h.signOut.mockResolvedValue({error:null});
  h.assurance.mockResolvedValue({data:{currentLevel:'aal2',nextLevel:'aal2'},error:null});
  h.link.mockResolvedValue({data:{url:'https://app.example.com/zh/auth/wechat/authorize?state=fixture'},error:null});
  h.login.mockResolvedValue({data:{url:'https://auth.example.com/auth/v1/authorize?provider=custom:wechat'},error:null});
});

describe('WeChat real session and password guards',()=>{
  it('treats only a genuinely missing session as a guest',async()=>{
    h.getUser.mockResolvedValue({data:{user:null},error:{name:'AuthSessionMissingError'}});
    expect((await currentWechatAuthContext()).userId).toBeNull();
    h.getUser.mockResolvedValue({data:{user:null},error:{name:'NetworkError'}});
    await expect(currentWechatAuthContext()).rejects.toThrow('failed');
  });
  it('rejects claims from another user and a switched session',async()=>{
    h.getClaims.mockResolvedValue({data:{claims:{sub:sessionId,session_id:sessionId}},error:null});
    await expect(currentWechatAuthContext()).rejects.toThrow('failed');
    h.getClaims.mockResolvedValue({data:{claims:{sub:userId,session_id:userId}},error:null});
    await expect(assertWechatFlowSession(flow)).rejects.toThrow('expired');
  });
  it('cleans up the password verification session without lowering the current MFA session',async()=>{
    await verifyWechatLinkPassword(userId,{email:'fixture@example.invalid'},'fixture-password');
    expect(h.signOut).toHaveBeenCalledWith({scope:'local'});
    expect(h.assurance).toHaveBeenCalledOnce();
    h.assurance.mockResolvedValue({data:{currentLevel:'aal1',nextLevel:'aal2'},error:null});
    await expect(verifyWechatLinkPassword(userId,{phone:'13800000000'},'fixture-password')).rejects.toThrow('credentials');
    expect(h.signOut).toHaveBeenCalledTimes(2);
  });
  it('fails closed when password ownership or MFA verification is unavailable',async()=>{
    h.password.mockResolvedValue({data:{user:{id:sessionId},session:{access_token:'fixture'}},error:null});
    await expect(verifyWechatLinkPassword(userId,{email:'fixture@example.invalid'},'fixture-password')).rejects.toThrow('credentials');
    expect(h.signOut).toHaveBeenCalledOnce();expect(h.assurance).not.toHaveBeenCalled();
    h.password.mockResolvedValue({data:{user:{id:userId},session:null},error:null});
    h.assurance.mockResolvedValue({data:null,error:{message:'unavailable'}});
    await expect(verifyWechatLinkPassword(userId,{email:'fixture@example.invalid'},'fixture-password')).rejects.toThrow('credentials');
  });
  it('keeps the PKCE handoff on registered origins and sets a Secure HttpOnly flow cookie',async()=>{
    await expect(beginWechatFlow(flow)).resolves.toContain('/zh/auth/wechat/authorize');
    expect(h.cookie).toHaveBeenCalledWith('mathin_wechat_flow',expect.any(String),expect.objectContaining({secure:true,httpOnly:true,sameSite:'lax'}));
    h.link.mockResolvedValue({data:{url:'https://different.example/authorize'},error:null});
    await expect(beginWechatFlow(flow)).rejects.toThrow('unavailable');
    h.origin='https://different.example';
    await expect(beginWechatFlow(flow)).rejects.toThrow('unavailable');
  });
});
