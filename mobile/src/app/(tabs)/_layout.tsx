import { Tabs } from 'expo-router/js-tabs'
import { useEffect } from 'react'

import { syncMemberZone } from '@/data/zone'
import { openWeb } from '@/lib/webNav'
import { consumeEmailRegistration } from '@/session/store'
import { TabBar } from '@/ui/TabBar'
import { useTheme } from '@/ui/theme'

export default function TabsLayout() {
  const theme = useTheme()

  useEffect(() => {
    void syncMemberZone()
    // 이메일이 없는 로컬 계정으로 로그인했다. 웹과 같이 이메일 등록 화면부터 보여 준다.
    if (consumeEmailRegistration()) openWeb('/email-registration')
  }, [])

  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: theme.bg } }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="schedules" />
      <Tabs.Screen name="tasks" />
      <Tabs.Screen name="more" />
    </Tabs>
  )
}
