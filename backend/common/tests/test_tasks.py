from common.tasks import ping


def test_ping_task_runs_through_celery() -> None:
    assert ping.delay().get(timeout=1) == "pong"
