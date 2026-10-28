from unittest import mock

from django.apps import apps

from apps.accounts import apps as accounts_apps


def test_ready_imports_allauth_template_tags_once_at_startup() -> None:
    config = apps.get_app_config("accounts")

    with mock.patch.object(accounts_apps, "import_module") as import_module:
        config.ready()

    import_module.assert_called_once_with("allauth.account.templatetags.account")
