#include <Security/Authorization.h>
#include <Security/AuthorizationTags.h>
#include <sys/stat.h>
#include <pwd.h>
#include <unistd.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* This launcher is user initiated. It exposes only the bundled manager's
   guarded TUN start/stop operations, never a supplied command or config path. */
static int fail(const char *message) {
    printf("{\"running\":false,\"mode\":\"error\",\"pid\":null,\"configPath\":\"\",\"message\":\"%s\"}",message);
    return 1;
}
int main(int argc,char **argv) {
    if(argc!=2 || (strcmp(argv[1],"--start-tun") && strcmp(argv[1],"--stop")))return fail("管理员操作参数无效。");
    if(getuid()<500 || geteuid()!=getuid())return fail("请从 AX1OM 应用启动此操作。");
    char launcher[PATH_MAX],node[PATH_MAX],script[PATH_MAX],uid[32],gid[32];
    if(!realpath(argv[0],launcher))return fail("启动器路径无效。");
    char *slash=strrchr(launcher,'/');if(!slash)return fail("启动器路径无效。");*slash=0;
    if(snprintf(node,sizeof(node),"%s/node",launcher)>=sizeof(node) || snprintf(script,sizeof(script),"%s/../AX1OM_AX1OM.bundle/Resources/core-manager.cjs",launcher)>=sizeof(script))return fail("应用资源路径过长。");
    struct stat info;
    if(lstat(node,&info)||!S_ISREG(info.st_mode)||access(node,X_OK)||(info.st_uid!=getuid()&&info.st_uid!=0)||(info.st_mode&0022))return fail("内置运行组件权限无效。");
    if(lstat(script,&info)||!S_ISREG(info.st_mode)||(info.st_uid!=getuid()&&info.st_uid!=0)||(info.st_mode&0022))return fail("内置内核管理器权限无效。");
    struct passwd *owner=getpwuid(getuid());if(!owner || !owner->pw_dir || strncmp(owner->pw_dir,"/Users/",7))return fail("本机用户信息无效。");
    snprintf(uid,sizeof(uid),"%u",getuid());snprintf(gid,sizeof(gid),"%u",getgid());
    AuthorizationRef authorization=NULL;
    OSStatus result=AuthorizationCreate(NULL,kAuthorizationEmptyEnvironment,kAuthorizationFlagDefaults,&authorization);
    if(result!=errAuthorizationSuccess)return fail("无法创建管理员授权。");
    AuthorizationItem item={kAuthorizationRightExecute,strlen(node),node,0};
    AuthorizationRights rights={1,&item};
    result=AuthorizationCopyRights(authorization,&rights,kAuthorizationEmptyEnvironment,kAuthorizationFlagInteractionAllowed|kAuthorizationFlagExtendRights|kAuthorizationFlagPreAuthorize,NULL);
    if(result!=errAuthorizationSuccess){AuthorizationFree(authorization,kAuthorizationFlagDestroyRights);return fail("管理员授权已取消，当前代理未改变。");}
    char *arguments[]={script,"--privileged",owner->pw_dir,uid,gid,argv[1],NULL};
    FILE *communication=NULL;
    unsetenv("NODE_OPTIONS");unsetenv("NODE_PATH");unsetenv("NODE_REPL_EXTERNAL_MODULE");
    unsetenv("DYLD_INSERT_LIBRARIES");unsetenv("DYLD_LIBRARY_PATH");unsetenv("DYLD_FRAMEWORK_PATH");
    unsetenv("AX1OM_MIHOMO_BINARY");setenv("PATH","/usr/bin:/bin:/usr/sbin:/sbin",1);
    result=AuthorizationExecuteWithPrivileges(authorization,node,kAuthorizationFlagDefaults,arguments,&communication);
    if(result!=errAuthorizationSuccess || !communication){AuthorizationFree(authorization,kAuthorizationFlagDestroyRights);return fail("管理员启动失败，当前代理未改变。");}
    alarm(65);
    char buffer[4096];size_t count,total=0;
    while((count=fread(buffer,1,sizeof(buffer),communication))>0){total+=count;if(total>65536)break;fwrite(buffer,1,count,stdout);}
    fclose(communication);alarm(0);AuthorizationFree(authorization,kAuthorizationFlagDestroyRights);
    return total>65536?1:0;
}
