; 卸载器只认识安装时写入的文件，这里清掉换图标时留下的运行时备份，
; 再把已经空的程序目录删除。
!macro NSIS_HOOK_POSTUNINSTALL
  Delete "$INSTDIR\CraftSharp.exe.old*"
  Delete "$INSTDIR\CraftSharp.exe.icon-new"
  RMDir "$INSTDIR"
!macroend
