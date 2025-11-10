'use client'

import { ConfirmPasswordField, Form, FormSubmit, HiddenField, PasswordField, useAuth, useConfig, useTranslation } from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import { formatAdminURL } from 'payload/shared'
import React from 'react'

const initialState = {
  'confirm-password': {
    initialValue: '',
    valid: false,
    value: '',
  },
  password: {
    initialValue: '',
    valid: false,
    value: '',
  },
}

/**
 * Custom Reset Password Form that redirects based on user role
 * - Hosts → /admin/upload-episode
 * - Admin/Staff → /admin (default)
 */
export const CustomResetPasswordForm: React.FC<{ token: string }> = ({ token }) => {
  const { i18n } = useTranslation()
  const { config } = useConfig()
  const router = useRouter()
  const { fetchFullUser } = useAuth()

  const {
    admin: {
      routes: { login: loginRoute },
      user: userSlug,
    },
    routes: { admin: adminRoute, api: apiRoute },
    serverURL,
  } = config

  const onSuccess = async () => {
    const user = await fetchFullUser()
    
    if (user) {
      // Redirect based on role
      if ((user as any).role === 'host') {
        router.push('/admin/upload-episode')
      } else {
        router.push(adminRoute)
      }
    } else {
      router.push(
        formatAdminURL({
          adminRoute,
          path: loginRoute,
        }),
      )
    }
  }

  return (
    <Form
      action={`${serverURL}${apiRoute}/${userSlug}/reset-password`}
      className="reset-password-form"
      initialState={initialState}
      method="POST"
      onSuccess={onSuccess}
      redirect={undefined}
    >
      <PasswordField
        autoComplete="off"
        field={{
          name: 'password',
          label: i18n.t('authentication:newPassword'),
          required: true,
        }}
        path="password"
      />
      <ConfirmPasswordField
        field={{
          name: 'confirm-password',
          label: i18n.t('authentication:confirmPassword'),
          required: true,
        }}
        passwordPath="password"
        path="confirm-password"
      />
      <HiddenField field={{ name: 'token' }} path="token" value={token} />
      <FormSubmit>{i18n.t('authentication:resetPassword')}</FormSubmit>
    </Form>
  )
}

