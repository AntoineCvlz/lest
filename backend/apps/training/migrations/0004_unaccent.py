from django.contrib.postgres.operations import UnaccentExtension
from django.db import migrations


class Migration(migrations.Migration):
    # Recherche du catalogue insensible aux accents (« developpe » trouve « Développé »).
    # Extension « trusted » depuis PostgreSQL 13 : le droit CREATE sur la base suffit.
    dependencies = [("training", "0003_personalrecord")]

    operations = [UnaccentExtension()]
