package com.alveryn.api.common.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.DriverManager;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;

class ProductionMigrationSafetyTest {
  private static final String LOCAL_ACCOUNT_EMAIL = "eusebiujacot@gmail.com";

  @Test
  void productionMigrationsDoNotContainPersonalDeveloperAccount() throws Exception {
    try (var paths = Files.walk(Path.of("src/main/resources/db/migration"))) {
      var sqlFiles = paths.filter(path -> path.toString().endsWith(".sql")).toList();

      assertThat(sqlFiles).isNotEmpty();
      for (Path sqlFile : sqlFiles) {
        assertThat(Files.readString(sqlFile))
            .as("Production migration must not reference personal local account: %s", sqlFile)
            .doesNotContain(LOCAL_ACCOUNT_EMAIL);
      }
    }
  }

  @Test
  void cleanDatabaseMigratesFromV1ToLatest() {
    String schema = "flyway_clean_" + UUID.randomUUID().toString().replace("-", "");
    Flyway flyway =
        Flyway.configure()
            .dataSource(
                System.getenv().getOrDefault("DB_URL", "jdbc:postgresql://localhost:5432/alveryn"),
                System.getenv().getOrDefault("DB_USERNAME", "alveryn"),
                System.getenv().getOrDefault("DB_PASSWORD", "change-me"))
            .schemas(schema)
            .defaultSchema(schema)
            .createSchemas(true)
            .cleanDisabled(false)
            .locations("classpath:db/migration")
            .load();

    try {
      assertThat(flyway.migrate().migrationsExecuted).isGreaterThan(0);
      assertThat(flyway.info().current().getVersion().getVersion()).isEqualTo(latestMigrationVersion());
    } finally {
      flyway.clean();
    }
  }

  @Test
  void existingV92SchemaMigratesToV93WithoutChangingImmutableVersions() throws Exception {
    String schema = "flyway_v92_publish_" + UUID.randomUUID().toString().replace("-", "");
    String url = System.getenv().getOrDefault("DB_URL", "jdbc:postgresql://localhost:5432/alveryn");
    String username = System.getenv().getOrDefault("DB_USERNAME", "alveryn");
    String password = System.getenv().getOrDefault("DB_PASSWORD", "change-me");
    try {
      assertThat(flyway(url, username, password, schema, "92").migrate().migrationsExecuted)
          .isGreaterThan(0);
      Flyway v93 = flyway(url, username, password, schema, "93");
      assertThat(v93.migrate().migrationsExecuted).isEqualTo(1);
      assertThat(v93.info().current().getVersion().getVersion()).isEqualTo("93");
      try (var connection = DriverManager.getConnection(url, username, password);
          var statement = connection.createStatement()) {
        statement.execute("set search_path to " + schema);
        assertCount(statement, "staffing_plan_publication_operations", 0);
        assertQueryCount(statement,
            "select count(*) from pg_constraint where conname='ck_staffing_plan_versions_kind' "
                + "and conrelid='staffing_plan_versions'::regclass",
            1);
      }
    } finally {
      clean(url, username, password, schema);
    }
  }

  @Test
  void existingV93SchemaMigratesToV94WithNullableCanonicalCoverage() throws Exception {
    String schema = "flyway_v93_coverage_" + UUID.randomUUID().toString().replace("-", "");
    String url = System.getenv().getOrDefault("DB_URL", "jdbc:postgresql://localhost:5432/alveryn");
    String username = System.getenv().getOrDefault("DB_USERNAME", "alveryn");
    String password = System.getenv().getOrDefault("DB_PASSWORD", "change-me");
    try {
      assertThat(flyway(url, username, password, schema, "93").migrate().migrationsExecuted)
          .isGreaterThan(0);
      Flyway v94 = flyway(url, username, password, schema, "94");
      assertThat(v94.migrate().migrationsExecuted).isEqualTo(1);
      assertThat(v94.info().current().getVersion().getVersion()).isEqualTo("94");
      try (var connection = DriverManager.getConnection(url, username, password);
          var statement = connection.createStatement()) {
        statement.execute("set search_path to " + schema);
        assertQueryCount(statement,
            "select count(*) from information_schema.columns where table_schema='" + schema
                + "' and table_name='staffing_plan_versions' and column_name in "
                + "('coverage_raw_assigned','coverage_effective_assigned','coverage_covered',"
                + "'coverage_missing','coverage_overstaffed')",
            5);
        assertQueryCount(statement,
            "select count(*) from pg_constraint where conname="
                + "'ck_staffing_plan_versions_canonical_coverage' "
                + "and conrelid='staffing_plan_versions'::regclass",
            1);
      }
    } finally {
      clean(url, username, password, schema);
    }
  }

  @Test
  void existingV94SchemaMigratesToV95WithEmptyDraftIdempotencyLedger() throws Exception {
    String schema = "flyway_v94_mutations_" + UUID.randomUUID().toString().replace("-", "");
    String url = System.getenv().getOrDefault("DB_URL", "jdbc:postgresql://localhost:5432/alveryn");
    String username = System.getenv().getOrDefault("DB_USERNAME", "alveryn");
    String password = System.getenv().getOrDefault("DB_PASSWORD", "change-me");
    try {
      assertThat(flyway(url, username, password, schema, "94").migrate().migrationsExecuted)
          .isGreaterThan(0);
      Flyway v95 = flyway(url, username, password, schema, "95");
      assertThat(v95.migrate().migrationsExecuted).isEqualTo(1);
      assertThat(v95.info().current().getVersion().getVersion()).isEqualTo("95");
      try (var connection = DriverManager.getConnection(url, username, password);
          var statement = connection.createStatement()) {
        statement.execute("set search_path to " + schema);
        assertCount(statement, "staffing_plan_draft_mutation_operations", 0);
        assertQueryCount(statement,
            "select count(*) from pg_constraint where conname="
                + "'ux_staffing_plan_draft_operations_key' "
                + "and conrelid='staffing_plan_draft_mutation_operations'::regclass",
            1);
        assertQueryCount(statement,
            "select count(*) from pg_constraint where conname="
                + "'fk_staffing_plan_draft_operations_plan' "
                + "and confdeltype='c' "
                + "and conrelid='staffing_plan_draft_mutation_operations'::regclass",
            1);
        assertQueryCount(statement,
            "select count(*) from pg_constraint where conname="
                + "'fk_staffing_plan_draft_operations_actor' "
                + "and conrelid='staffing_plan_draft_mutation_operations'::regclass",
            0);
        for (String constraint : List.of(
            "ck_staffing_plan_draft_operations_status",
            "ck_staffing_plan_draft_operations_family",
            "ck_staffing_plan_draft_operations_key",
            "ck_staffing_plan_draft_operations_revision",
            "ck_staffing_plan_draft_operations_fingerprint",
            "ck_staffing_plan_draft_operations_completion",
            "ck_staffing_plan_draft_operations_response")) {
          assertQueryCount(statement,
              "select count(*) from pg_constraint where conname='" + constraint + "' "
                  + "and conrelid='staffing_plan_draft_mutation_operations'::regclass",
              1);
        }
      }
    } finally {
      clean(url, username, password, schema);
    }
  }

  @Test
  void existingV95SchemaMigratesToV96WithPlanCreateIdempotencyScope() throws Exception {
    String schema = "flyway_v95_plan_create_" + UUID.randomUUID().toString().replace("-", "");
    String url = System.getenv().getOrDefault("DB_URL", "jdbc:postgresql://localhost:5432/alveryn");
    String username = System.getenv().getOrDefault("DB_USERNAME", "alveryn");
    String password = System.getenv().getOrDefault("DB_PASSWORD", "change-me");
    try {
      assertThat(flyway(url, username, password, schema, "95").migrate().migrationsExecuted)
          .isGreaterThan(0);
      Flyway v96 = flyway(url, username, password, schema, "96");
      assertThat(v96.migrate().migrationsExecuted).isEqualTo(1);
      assertThat(v96.info().current().getVersion().getVersion()).isEqualTo("96");
      try (var connection = DriverManager.getConnection(url, username, password);
          var statement = connection.createStatement()) {
        statement.execute("set search_path to " + schema);
        assertQueryCount(statement,
            "select count(*) from pg_constraint where conname="
                + "'ck_staffing_plan_draft_operations_family' and "
                + "pg_get_constraintdef(oid) like '%PLAN_CREATE%' "
                + "and conrelid='staffing_plan_draft_mutation_operations'::regclass",
            1);
        assertQueryCount(statement,
            "select count(*) from pg_indexes where schemaname=current_schema() and tablename="
                + "'staffing_plan_draft_mutation_operations' and indexname="
                + "'ux_staffing_plan_create_operations_key' "
                + "and indexdef like '%WHERE%' and indexdef like '%PLAN_CREATE%'",
            1);
        assertCount(statement, "staffing_plan_draft_mutation_operations", 0);
      }
    } finally {
      clean(url, username, password, schema);
    }
  }

  @Test
  void existingV97SchemaMigratesOnceToV98WithoutBackfillingGranularCoverage() throws Exception {
    String schema = "flyway_v97_granular_" + UUID.randomUUID().toString().replace("-", "");
    String url = System.getenv().getOrDefault("DB_URL", "jdbc:postgresql://localhost:5432/alveryn");
    String username = System.getenv().getOrDefault("DB_USERNAME", "alveryn");
    String password = System.getenv().getOrDefault("DB_PASSWORD", "change-me");
    try {
      assertThat(flyway(url, username, password, schema, "97").migrate().migrationsExecuted)
          .isGreaterThan(0);
      Flyway v98 = flyway(url, username, password, schema, "98");
      assertThat(v98.migrate().migrationsExecuted).isEqualTo(1);
      assertThat(v98.info().current().getVersion().getVersion()).isEqualTo("98");
      try (var connection = DriverManager.getConnection(url, username, password);
          var statement = connection.createStatement()) {
        statement.execute("set search_path to " + schema);
        assertCount(statement, "staffing_plan_version_requirement_coverage", 0);
        assertCount(statement, "staffing_plan_version_day_coverage", 0);
        assertQueryCount(statement,
            "select count(*) from information_schema.columns where table_schema='" + schema
                + "' and table_name='staffing_plan_versions' and column_name='checksum_format_version'",
            1);
        assertQueryCount(statement,
            "select count(*) from pg_constraint where conname='ck_staffing_plan_versions_basis' "
                + "and connamespace=current_schema()::regnamespace "
                + "and pg_get_constraintdef(oid) like '%LEGACY_V90%' "
                + "and pg_get_constraintdef(oid) like '%CANONICAL_REQUIREMENT_V1%'",
            1);
        for (String constraint : List.of(
            "ck_version_requirement_coverage_values",
            "ck_version_requirement_coverage_week",
            "ux_version_requirement_coverage_snapshot",
            "ck_version_day_coverage_values",
            "ck_version_day_coverage_week",
            "ux_version_day_coverage_date")) {
          assertQueryCount(statement,
              "select count(*) from pg_constraint where conname='" + constraint
                  + "' and connamespace=current_schema()::regnamespace", 1);
        }
      }
    } finally {
      clean(url, username, password, schema);
    }
  }

  @Test
  void existingV96SchemaMigratesThroughInvitationsAndGranularCoverageToV98() throws Exception {
    String schema = "flyway_v96_to_v98_" + UUID.randomUUID().toString().replace("-", "");
    String url = System.getenv().getOrDefault("DB_URL", "jdbc:postgresql://localhost:5432/alveryn");
    String username = System.getenv().getOrDefault("DB_USERNAME", "alveryn");
    String password = System.getenv().getOrDefault("DB_PASSWORD", "change-me");
    try {
      assertThat(flyway(url, username, password, schema, "96").migrate().migrationsExecuted)
          .isGreaterThan(0);
      Flyway v98 = flyway(url, username, password, schema, "98");
      assertThat(v98.migrate().migrationsExecuted).isEqualTo(2);
      assertThat(v98.info().current().getVersion().getVersion()).isEqualTo("98");
      assertThat(
              List.of(v98.info().applied())
                  .stream()
                  .filter(info -> info.getVersion() != null)
                  .filter(info -> List.of("97", "98").contains(info.getVersion().getVersion()))
                  .map(info -> info.getDescription())
                  .toList())
          .containsExactly(
              "secure business invitations", "add granular staffing coverage snapshots");
      try (var connection = DriverManager.getConnection(url, username, password);
          var statement = connection.createStatement()) {
        statement.execute("set search_path to " + schema);
        assertCount(statement, "staffing_plan_version_requirement_coverage", 0);
        assertCount(statement, "staffing_plan_version_day_coverage", 0);
      }
    } finally {
      clean(url, username, password, schema);
    }
  }

  @Test
  void existingV90StaffingDataBackfillsWeeklyPlansAndLegacyVersionWithoutChangingRows()
      throws Exception {
    String schema = "flyway_v90_staffing_" + UUID.randomUUID().toString().replace("-", "");
    String url = System.getenv().getOrDefault("DB_URL", "jdbc:postgresql://localhost:5432/alveryn");
    String username = System.getenv().getOrDefault("DB_USERNAME", "alveryn");
    String password = System.getenv().getOrDefault("DB_PASSWORD", "change-me");
    Flyway v90 = flyway(url, username, password, schema, "90");

    try {
      v90.migrate();
      insertV90StaffingFixture(url, username, password, schema);

      try (var connection = DriverManager.getConnection(url, username, password);
          var statement = connection.createStatement()) {
        statement.execute("set search_path to " + schema);
        assertCount(statement, "staffing_requirements", 3);
        assertCount(statement, "staffing_assignments", 2);
        assertCount(statement, "staffing_member_day_entries", 1);
      }

      Flyway latest = flyway(url, username, password, schema, null);
      assertThat(latest.migrate().migrationsExecuted).isEqualTo(11);
      assertThat(latest.info().current().getVersion().getVersion()).isEqualTo("101");

      try (var connection = DriverManager.getConnection(url, username, password);
          var statement = connection.createStatement()) {
        statement.execute("set search_path to " + schema);
        assertCount(statement, "staffing_requirements", 3);
        assertCount(statement, "staffing_assignments", 2);
        assertCount(statement, "staffing_member_day_entries", 1);
        assertCount(statement, "staffing_plans", 2);
        assertCount(statement, "staffing_plan_days", 3);
        assertCount(statement, "staffing_plan_versions", 1);
        assertCount(statement, "staffing_plan_version_days", 1);
        assertCount(statement, "staffing_plan_version_requirements", 1);
        assertCount(statement, "staffing_plan_version_assignments", 1);
        assertCount(statement, "staffing_plan_version_member_days", 1);
        assertCount(statement, "staffing_plan_version_acknowledgements", 0);
        assertCount(statement, "staffing_plan_publication_operations", 0);
        assertCount(statement, "staffing_plan_draft_mutation_operations", 0);
        assertCount(statement, "staffing_plan_version_requirement_coverage", 0);
        assertCount(statement, "staffing_plan_version_day_coverage", 0);
        assertQueryCount(statement,
            "select count(*) from staffing_plan_versions where checksum_format_version=1", 1);
        assertQueryCount(statement,
            "select count(*) from staffing_requirements where plan_day_id is null", 0);
        assertQueryCount(statement,
            "select count(*) from staffing_plan_days where source <> 'LEGACY_BACKFILL'", 0);
        assertQueryCount(statement,
            "select count(*) from staffing_plans where timezone <> 'Europe/Berlin'", 0);
        assertQueryCount(statement,
            "select count(*) from staffing_plans where plan_status <> 'ACTIVE' or draft_revision <> 0 or lock_version <> 0",
            0);
        assertQueryCount(statement,
            "select count(*) from staffing_requirements where publication_status = 'PUBLISHED' and published_at is not null",
            1);
        assertQueryCount(statement,
            "select count(*) from staffing_requirements where publication_status = 'DRAFT' and published_at is null",
            2);
        assertQueryCount(statement,
            "select count(*) from staffing_requirements where id in ("
                + "'00000000-0000-0000-0000-000000000951',"
                + "'00000000-0000-0000-0000-000000000952',"
                + "'00000000-0000-0000-0000-000000000953')",
            3);
        assertQueryCount(statement,
            "select sum(required_workers) from staffing_requirements", 7);
        assertQueryCount(statement,
            "select count(*) from staffing_assignments where id in ("
                + "'00000000-0000-0000-0000-000000000961',"
                + "'00000000-0000-0000-0000-000000000962')",
            2);
        assertQueryCount(statement,
            "select count(*) from staffing_member_day_entries "
                + "where id = '00000000-0000-0000-0000-000000000971' "
                + "and notes = 'Preserve this entry'",
            1);
        assertQueryCount(statement,
            "select count(*) from staffing_plan_days day join staffing_plans plan on plan.id = day.plan_id "
                + "where day.organization_id <> plan.organization_id "
                + "or day.work_date < plan.week_start or day.work_date > plan.week_start + 6",
            0);
        assertQueryCount(statement,
            "select count(*) from staffing_requirements requirement "
                + "join staffing_plan_days day on day.id = requirement.plan_day_id "
                + "join staffing_plans plan on plan.id = day.plan_id "
                + "where requirement.organization_id <> plan.organization_id "
                + "or requirement.unit_id <> plan.unit_id "
                + "or requirement.work_date <> day.work_date",
            0);
        assertQueryCount(statement,
            "select count(*) from staffing_plan_versions "
                + "where version_number = 1 and source_draft_revision = 0 "
                + "and publication_kind = 'LEGACY_PARTIAL' and coverage_basis = 'LEGACY_V90' "
                + "and source_draft_complete = false "
                + "and coverage_required = 4 and coverage_assigned = 1 "
                + "and coverage_percentage = 25.00 and warning_count = 1 "
                + "and published_by_membership_id is null "
                + "and checksum ~ '^[0-9a-f]{64}$'",
            1);
        assertQueryCount(statement,
            "select count(*) from staffing_plan_versions where publication_kind='LEGACY_PARTIAL' "
                + "and coverage_raw_assigned is null and coverage_effective_assigned is null "
                + "and coverage_covered is null and coverage_missing is null "
                + "and coverage_overstaffed is null",
            1);
        assertQueryCount(statement,
            "select count(*) from staffing_plans "
                + "where latest_published_version_id is not null "
                + "and published_revision = 0 and published_at is not null "
                + "and (draft_revision > published_revision "
                + "or not (select source_draft_complete from staffing_plan_versions "
                + "where id = latest_published_version_id))",
            1);
        assertQueryCount(statement,
            "select count(*) from staffing_plans "
                + "where latest_published_version_id is null "
                + "and published_revision is null and published_at is null",
            1);
        assertQueryCount(statement,
            "select count(*) from staffing_plan_version_requirements "
                + "where source_requirement_id = '00000000-0000-0000-0000-000000000951' "
                + "and legacy_publication_status = 'PUBLISHED' "
                + "and work_type_code = 'ROOM' and unit_name = 'Hotel Munich'",
            1);
        assertQueryCount(statement,
            "select count(*) from staffing_plan_version_assignments "
                + "where source_assignment_id = '00000000-0000-0000-0000-000000000961' "
                + "and assignment_status = 'ASSIGNED' and membership_status_snapshot = 'ACTIVE' "
                + "and member_display_name = 'Member 00000000'",
            1);
        assertQueryCount(statement,
            "select count(*) from staffing_plan_version_assignments "
                + "where member_display_name like '%@%'",
            0);

        String checksumBeforeSourceMutation = queryString(
            url, username, password, schema, "select checksum from staffing_plan_versions");
        statement.executeUpdate(
            "update organization_units set name = 'Renamed source unit', active = false "
                + "where id = '00000000-0000-0000-0000-000000000931'");
        statement.executeUpdate(
            "update organization_work_types set name = 'Renamed source work type', active = false "
                + "where id = '00000000-0000-0000-0000-000000000941'");
        statement.executeUpdate(
            "update organization_memberships set membership_status = 'SUSPENDED' "
                + "where id = '00000000-0000-0000-0000-000000000921'");
        statement.executeUpdate(
            "delete from staffing_requirements where organization_id = "
                + "'00000000-0000-0000-0000-000000000911'");
        statement.executeUpdate(
            "delete from organization_memberships "
                + "where id = '00000000-0000-0000-0000-000000000921'");
        assertQueryCount(statement,
            "select count(*) from staffing_plan_version_requirements "
                + "where unit_name = 'Hotel Munich' and work_type_name = 'Room cleaning'",
            1);
        assertQueryCount(statement,
            "select count(*) from staffing_plan_version_assignments "
                + "where unit_name = 'Hotel Munich' and work_type_name = 'Room cleaning' "
                + "and membership_status_snapshot = 'ACTIVE'",
            1);
        assertQueryCount(statement, "select count(*) from staffing_plan_version_member_days", 1);
        assertThatThrownBy(() -> statement.executeUpdate(
            "delete from staffing_plans where latest_published_version_id is not null"))
                .hasMessageContaining("fk_staffing_plan_versions_plan_scope");
        assertCount(statement, "staffing_plan_versions", 1);
        assertThat(queryString(url, username, password, schema,
            "select checksum from staffing_plan_versions"))
                .isEqualTo(checksumBeforeSourceMutation);
      }
    } finally {
      clean(url, username, password, schema);
    }
  }

  @Test
  void v92MarksCompleteLegacyDraftOnlyWhenEveryPlanRequirementWasPublished() throws Exception {
    String schema = "flyway_v90_complete_" + UUID.randomUUID().toString().replace("-", "");
    String url = System.getenv().getOrDefault("DB_URL", "jdbc:postgresql://localhost:5432/alveryn");
    String username = System.getenv().getOrDefault("DB_USERNAME", "alveryn");
    String password = System.getenv().getOrDefault("DB_PASSWORD", "change-me");

    try {
      flyway(url, username, password, schema, "90").migrate();
      insertV90StaffingFixture(url, username, password, schema);
      try (var connection = DriverManager.getConnection(url, username, password);
          var statement = connection.createStatement()) {
        statement.execute("set search_path to " + schema);
        statement.executeUpdate(
            "update staffing_requirements set publication_status = 'PUBLISHED', "
                + "published_at = coalesce(published_at, updated_at) "
                + "where unit_id = '00000000-0000-0000-0000-000000000931'");
      }

      assertThat(flyway(url, username, password, schema, "92").migrate().migrationsExecuted)
          .isEqualTo(2);
      try (var connection = DriverManager.getConnection(url, username, password);
          var statement = connection.createStatement()) {
        statement.execute("set search_path to " + schema);
        assertQueryCount(statement,
            "select count(*) from staffing_plan_versions version "
                + "join staffing_plans plan on plan.latest_published_version_id = version.id "
                + "where version.source_draft_complete = true "
                + "and plan.draft_revision = plan.published_revision",
            1);
        assertQueryCount(statement,
            "select count(*) from staffing_plan_versions version "
                + "join staffing_plans plan on plan.latest_published_version_id = version.id "
                + "where not version.source_draft_complete "
                + "or plan.draft_revision > plan.published_revision",
            0);
      }
    } finally {
      clean(url, username, password, schema);
    }
  }

  @Test
  void v92MemberDaySnapshotsFollowPublishedAssignmentsNotOrganizationWideUnitAccess()
      throws Exception {
    String schema = "flyway_v90_member_scope_" + UUID.randomUUID().toString().replace("-", "");
    String url = System.getenv().getOrDefault("DB_URL", "jdbc:postgresql://localhost:5432/alveryn");
    String username = System.getenv().getOrDefault("DB_USERNAME", "alveryn");
    String password = System.getenv().getOrDefault("DB_PASSWORD", "change-me");

    try {
      flyway(url, username, password, schema, "90").migrate();
      insertV90StaffingFixture(url, username, password, schema);
      try (var connection = DriverManager.getConnection(url, username, password);
          var statement = connection.createStatement()) {
        statement.execute("set search_path to " + schema);
        statement.executeUpdate(
            "insert into user_accounts (id, email, password_hash, email_verified) values "
                + "('00000000-0000-0000-0000-000000000902', "
                + "'multi-unit-member@example.com', 'hash', true)");
        statement.executeUpdate(
            "insert into organization_memberships "
                + "(id, organization_id, user_id, membership_role, membership_status, "
                + "first_name, last_name) values "
                + "('00000000-0000-0000-0000-000000000923', "
                + "'00000000-0000-0000-0000-000000000911', "
                + "'00000000-0000-0000-0000-000000000902', 'EMPLOYEE', 'ACTIVE', "
                + "'Multi', 'Unit')");
        statement.executeUpdate(
            "insert into organization_unit_memberships "
                + "(id, unit_id, membership_id, active) values "
                + "('00000000-0000-0000-0000-000000000933', "
                + "'00000000-0000-0000-0000-000000000931', "
                + "'00000000-0000-0000-0000-000000000923', true), "
                + "('00000000-0000-0000-0000-000000000935', "
                + "'00000000-0000-0000-0000-000000000932', "
                + "'00000000-0000-0000-0000-000000000923', true)");
        statement.executeUpdate(
            "update staffing_requirements set publication_status = 'PUBLISHED', "
                + "published_at = updated_at "
                + "where id = '00000000-0000-0000-0000-000000000953'");
        statement.executeUpdate(
            "insert into staffing_assignments "
                + "(id, requirement_id, membership_id, assignment_status, "
                + "assigned_by_membership_id) values "
                + "('00000000-0000-0000-0000-000000000964', "
                + "'00000000-0000-0000-0000-000000000953', "
                + "'00000000-0000-0000-0000-000000000923', 'ASSIGNED', "
                + "'00000000-0000-0000-0000-000000000921')");
        statement.executeUpdate(
            "insert into staffing_member_day_entries "
                + "(id, organization_id, membership_id, work_date, entry_type, notes) values "
                + "('00000000-0000-0000-0000-000000000972', "
                + "'00000000-0000-0000-0000-000000000911', "
                + "'00000000-0000-0000-0000-000000000923', "
                + "'2026-08-12', 'REST_DAY', 'Relevant only where assigned')");
      }

      assertThat(flyway(url, username, password, schema, "92").migrate().migrationsExecuted)
          .isEqualTo(2);
      try (var connection = DriverManager.getConnection(url, username, password);
          var statement = connection.createStatement()) {
        statement.execute("set search_path to " + schema);
        assertQueryCount(statement,
            "select count(*) from staffing_plan_version_member_days member_day "
                + "join staffing_plan_versions version on version.id = member_day.version_id "
                + "where member_day.source_day_entry_id = "
                + "'00000000-0000-0000-0000-000000000972' "
                + "and version.unit_id = '00000000-0000-0000-0000-000000000931'",
            0);
        assertQueryCount(statement,
            "select count(*) from staffing_plan_version_member_days member_day "
                + "join staffing_plan_versions version on version.id = member_day.version_id "
                + "where member_day.source_day_entry_id = "
                + "'00000000-0000-0000-0000-000000000972' "
                + "and version.unit_id = '00000000-0000-0000-0000-000000000932'",
            1);
      }
    } finally {
      clean(url, username, password, schema);
    }
  }

  @Test
  void v92SnapshotsInvitedAssignmentsButExcludesThemFromEffectiveLegacyCoverage()
      throws Exception {
    String schema = "flyway_v90_invited_" + UUID.randomUUID().toString().replace("-", "");
    String url = System.getenv().getOrDefault("DB_URL", "jdbc:postgresql://localhost:5432/alveryn");
    String username = System.getenv().getOrDefault("DB_USERNAME", "alveryn");
    String password = System.getenv().getOrDefault("DB_PASSWORD", "change-me");

    try {
      flyway(url, username, password, schema, "90").migrate();
      insertV90StaffingFixture(url, username, password, schema);
      try (var connection = DriverManager.getConnection(url, username, password);
          var statement = connection.createStatement()) {
        statement.execute("set search_path to " + schema);
        statement.executeUpdate(
            """
            insert into organization_memberships (
              id, organization_id, user_id, membership_role, membership_status,
              first_name, last_name, invited_email
            ) values (
              '00000000-0000-0000-0000-000000000922',
              '00000000-0000-0000-0000-000000000911',
              null, 'EMPLOYEE', 'INVITED', 'Invited', 'Cleaner', 'invited-cleaner@example.com'
            )
            """);
        statement.executeUpdate(
            """
            insert into staffing_assignments (
              id, requirement_id, membership_id, assignment_status, assigned_by_membership_id
            ) values (
              '00000000-0000-0000-0000-000000000963',
              '00000000-0000-0000-0000-000000000951',
              '00000000-0000-0000-0000-000000000922',
              'ASSIGNED', '00000000-0000-0000-0000-000000000921'
            )
            """);
      }

      assertThat(flyway(url, username, password, schema, "92").migrate().migrationsExecuted)
          .isEqualTo(2);
      try (var connection = DriverManager.getConnection(url, username, password);
          var statement = connection.createStatement()) {
        statement.execute("set search_path to " + schema);
        assertQueryCount(statement,
            "select count(*) from staffing_plan_version_assignments "
                + "where source_assignment_id = '00000000-0000-0000-0000-000000000963' "
                + "and member_display_name = 'Invited Cleaner' "
                + "and membership_status_snapshot = 'INVITED'",
            1);
        assertQueryCount(statement,
            "select count(*) from staffing_plan_versions "
                + "where coverage_required = 4 and coverage_assigned = 1 "
                + "and coverage_percentage = 25.00 and warning_count = 1",
            1);
      }
    } finally {
      clean(url, username, password, schema);
    }
  }

  @Test
  void v92UsesDeterministicLegacyTimestampWhenPublishedAtWasNeverRecorded() throws Exception {
    String schema = "flyway_v90_null_publish_" + UUID.randomUUID().toString().replace("-", "");
    String url = System.getenv().getOrDefault("DB_URL", "jdbc:postgresql://localhost:5432/alveryn");
    String username = System.getenv().getOrDefault("DB_USERNAME", "alveryn");
    String password = System.getenv().getOrDefault("DB_PASSWORD", "change-me");

    try {
      flyway(url, username, password, schema, "90").migrate();
      insertV90StaffingFixture(url, username, password, schema);
      try (var connection = DriverManager.getConnection(url, username, password);
          var statement = connection.createStatement()) {
        statement.execute("set search_path to " + schema);
        statement.executeUpdate(
            "update staffing_requirements set published_at = null "
                + "where publication_status = 'PUBLISHED'");
      }

      assertThat(flyway(url, username, password, schema, "92").migrate().migrationsExecuted)
          .isEqualTo(2);
      try (var connection = DriverManager.getConnection(url, username, password);
          var statement = connection.createStatement()) {
        statement.execute("set search_path to " + schema);
        assertQueryCount(statement,
            "select count(*) from staffing_plan_versions where published_at is not null",
            1);
        assertQueryCount(statement,
            "select count(*) from staffing_requirements "
                + "where publication_status = 'PUBLISHED' and published_at is null",
            1);
      }
    } finally {
      clean(url, username, password, schema);
    }
  }

  @Test
  void v91StopsBeforeBackfillWhenLegacyStaffingDataCrossesTenants() throws Exception {
    String schema = "flyway_v90_anomaly_" + UUID.randomUUID().toString().replace("-", "");
    String url = System.getenv().getOrDefault("DB_URL", "jdbc:postgresql://localhost:5432/alveryn");
    String username = System.getenv().getOrDefault("DB_USERNAME", "alveryn");
    String password = System.getenv().getOrDefault("DB_PASSWORD", "change-me");
    Flyway v90 = flyway(url, username, password, schema, "90");

    try {
      v90.migrate();
      insertV90StaffingFixture(url, username, password, schema);
      try (var connection = DriverManager.getConnection(url, username, password);
          var statement = connection.createStatement()) {
        statement.execute("set search_path to " + schema);
        statement.executeUpdate(
            "update staffing_requirements "
                + "set unit_id = '00000000-0000-0000-0000-000000000934' "
                + "where id = '00000000-0000-0000-0000-000000000951'");
      }

      Flyway latest = flyway(url, username, password, schema, null);
      assertThatThrownBy(latest::migrate)
          .hasStackTraceContaining("V91 cannot backfill cross-tenant staffing requirement units");
    } finally {
      clean(url, username, password, schema);
    }
  }

  @Test
  void v91StopsBeforeBackfillWhenCanonicalOrganizationTimezoneIsInvalid() throws Exception {
    String schema = "flyway_v90_timezone_" + UUID.randomUUID().toString().replace("-", "");
    String url = System.getenv().getOrDefault("DB_URL", "jdbc:postgresql://localhost:5432/alveryn");
    String username = System.getenv().getOrDefault("DB_USERNAME", "alveryn");
    String password = System.getenv().getOrDefault("DB_PASSWORD", "change-me");
    Flyway v90 = flyway(url, username, password, schema, "90");

    try {
      v90.migrate();
      insertV90StaffingFixture(url, username, password, schema);
      try (var connection = DriverManager.getConnection(url, username, password);
          var statement = connection.createStatement()) {
        statement.execute("set search_path to " + schema);
        statement.executeUpdate(
            "update organizations set timezone = 'Invalid/Timezone' "
                + "where id = '00000000-0000-0000-0000-000000000911'");
      }

      Flyway latest = flyway(url, username, password, schema, null);
      assertThatThrownBy(latest::migrate)
          .hasStackTraceContaining(
              "V91 cannot backfill staffing plans with missing or invalid organization timezone");
    } finally {
      clean(url, username, password, schema);
    }
  }

  @Test
  void v92BackfillAndChecksumAreIndependentOfLegacyRequirementInsertionOrder() throws Exception {
    String normalSchema = "flyway_v90_order_a_" + UUID.randomUUID().toString().replace("-", "");
    String reversedSchema = "flyway_v90_order_b_" + UUID.randomUUID().toString().replace("-", "");
    String url = System.getenv().getOrDefault("DB_URL", "jdbc:postgresql://localhost:5432/alveryn");
    String username = System.getenv().getOrDefault("DB_USERNAME", "alveryn");
    String password = System.getenv().getOrDefault("DB_PASSWORD", "change-me");

    try {
      flywayAtTimezone(url, username, password, normalSchema, "90", "UTC").migrate();
      insertV90StaffingFixture(url, username, password, normalSchema, false);
      assertThat(flywayAtTimezone(url, username, password, normalSchema, null, "UTC")
          .migrate().migrationsExecuted)
          .isEqualTo(11);

      flywayAtTimezone(url, username, password, reversedSchema, "90", "Europe/Berlin").migrate();
      insertV90StaffingFixture(url, username, password, reversedSchema, true);
      assertThat(flywayAtTimezone(url, username, password, reversedSchema, null, "Europe/Berlin")
          .migrate().migrationsExecuted)
          .isEqualTo(11);

      try (var connection = DriverManager.getConnection(url, username, password);
          var statement = connection.createStatement()) {
        statement.execute("set search_path to " + reversedSchema);
        assertCount(statement, "staffing_plans", 2);
        assertCount(statement, "staffing_plan_days", 3);
        assertQueryCount(statement,
            "select count(*) from staffing_requirements where plan_day_id is null", 0);
        assertQueryCount(statement,
            "select count(*) from staffing_requirements requirement "
                + "join staffing_plan_days day on day.id = requirement.plan_day_id "
                + "join staffing_plans plan on plan.id = day.plan_id "
                + "where requirement.organization_id <> plan.organization_id "
                + "or requirement.unit_id <> plan.unit_id "
                + "or requirement.work_date <> day.work_date",
            0);
        assertQueryCount(statement,
            "select count(*) from staffing_requirements where id in ("
                + "'00000000-0000-0000-0000-000000000951',"
                + "'00000000-0000-0000-0000-000000000952',"
                + "'00000000-0000-0000-0000-000000000953')",
            3);
        assertQueryCount(statement,
            "select count(*) from staffing_requirements where publication_status = 'PUBLISHED'",
            1);
        assertQueryCount(statement,
            "select count(*) from staffing_requirements where publication_status = 'DRAFT'",
            2);
      }
      assertThat(queryString(url, username, password, normalSchema,
          "select checksum from staffing_plan_versions")).isEqualTo(
              queryString(url, username, password, reversedSchema,
                  "select checksum from staffing_plan_versions"));
    } finally {
      clean(url, username, password, normalSchema);
      clean(url, username, password, reversedSchema);
    }
  }

  @Test
  void v92DoesNotCreateVersionForPlanWithoutPublishedLegacyRequirements() throws Exception {
    String schema = "flyway_v91_draft_" + UUID.randomUUID().toString().replace("-", "");
    String url = System.getenv().getOrDefault("DB_URL", "jdbc:postgresql://localhost:5432/alveryn");
    String username = System.getenv().getOrDefault("DB_USERNAME", "alveryn");
    String password = System.getenv().getOrDefault("DB_PASSWORD", "change-me");

    try {
      flyway(url, username, password, schema, "90").migrate();
      insertV90StaffingFixture(url, username, password, schema);
      flyway(url, username, password, schema, "91").migrate();
      try (var connection = DriverManager.getConnection(url, username, password);
          var statement = connection.createStatement()) {
        statement.execute("set search_path to " + schema);
        statement.executeUpdate(
            "update staffing_requirements set publication_status = 'DRAFT', published_at = null");
      }

      assertThat(flyway(url, username, password, schema, "92").migrate().migrationsExecuted)
          .isEqualTo(1);
      try (var connection = DriverManager.getConnection(url, username, password);
          var statement = connection.createStatement()) {
        statement.execute("set search_path to " + schema);
        assertCount(statement, "staffing_plan_versions", 0);
        assertQueryCount(statement,
            "select count(*) from staffing_plans where latest_published_version_id is not null",
            0);
      }
    } finally {
      clean(url, username, password, schema);
    }
  }

  @Test
  void existingV16DatabaseWithWorkEntriesMigratesToLatestWithSimpleAddresses() throws Exception {
    String schema = "flyway_existing_" + UUID.randomUUID().toString().replace("-", "");
    String url = System.getenv().getOrDefault("DB_URL", "jdbc:postgresql://localhost:5432/alveryn");
    String username = System.getenv().getOrDefault("DB_USERNAME", "alveryn");
    String password = System.getenv().getOrDefault("DB_PASSWORD", "change-me");
    Flyway v16 =
        Flyway.configure()
            .dataSource(url, username, password)
            .schemas(schema)
            .defaultSchema(schema)
            .createSchemas(true)
            .cleanDisabled(false)
            .locations("classpath:db/migration")
            .target("16")
            .load();

    try {
      assertThat(v16.migrate().migrationsExecuted).isGreaterThan(0);
      insertLegacyWorkEntry(url, username, password, schema);

      Flyway latest =
          Flyway.configure()
              .dataSource(url, username, password)
              .schemas(schema)
              .defaultSchema(schema)
              .createSchemas(true)
              .cleanDisabled(false)
              .locations("classpath:db/migration")
              .load();

      latest.migrate();
      assertThat(latest.info().current().getVersion().getVersion()).isEqualTo(latestMigrationVersion());

      try (var connection = DriverManager.getConnection(url, username, password);
          var statement = connection.createStatement()) {
        statement.execute("set search_path to " + schema);
        try (var rs =
            statement.executeQuery(
                """
                select count(*)
                from information_schema.tables
                where table_schema = current_schema()
                  and table_name = 'work_entries'
                """)) {
          assertThat(rs.next()).isTrue();
          assertThat(rs.getInt(1)).isZero();
        }
        try (var rs =
            statement.executeQuery(
                """
                select count(*)
                from information_schema.tables
                where table_schema = current_schema()
                  and table_name = 'addresses'
                """)) {
          assertThat(rs.next()).isTrue();
          assertThat(rs.getInt(1)).isEqualTo(1);
        }
        try (var rs =
            statement.executeQuery(
                """
                select count(*)
                from information_schema.columns
                where table_schema = current_schema()
                  and table_name in ('work_entries', 'user_preferences')
                  and (column_name like 'address%' or column_name = 'default_address_id')
                """)) {
          assertThat(rs.next()).isTrue();
          assertThat(rs.getInt(1)).isZero();
        }
        try (var rs =
            statement.executeQuery(
                """
                select count(*)
                from information_schema.columns
                where table_schema = current_schema()
                  and table_name in ('user_profiles', 'work_records')
                  and column_name = 'address_id'
                """)) {
          assertThat(rs.next()).isTrue();
          assertThat(rs.getInt(1)).isEqualTo(2);
        }
      }
    } finally {
      Flyway.configure()
          .dataSource(url, username, password)
          .schemas(schema)
          .defaultSchema(schema)
          .cleanDisabled(false)
          .load()
          .clean();
    }
  }

  @Test
  void existingV28CompositeWorkTypeMigratesPastStricterCategoryConstraints() throws Exception {
    String schema = "flyway_v28_" + UUID.randomUUID().toString().replace("-", "");
    String url = System.getenv().getOrDefault("DB_URL", "jdbc:postgresql://localhost:5432/alveryn");
    String username = System.getenv().getOrDefault("DB_USERNAME", "alveryn");
    String password = System.getenv().getOrDefault("DB_PASSWORD", "change-me");
    Flyway v28 =
        Flyway.configure()
            .dataSource(url, username, password)
            .schemas(schema)
            .defaultSchema(schema)
            .createSchemas(true)
            .cleanDisabled(false)
            .locations("classpath:db/migration")
            .target("28")
            .load();

    try {
      v28.migrate();
      try (var connection = DriverManager.getConnection(url, username, password);
          var statement = connection.createStatement()) {
        statement.execute("set search_path to " + schema);
        statement.executeUpdate(
            """
            insert into user_accounts (id, email, password_hash, email_verified)
            values ('00000000-0000-0000-0000-000000000401', 'v28-category@example.com', 'hash', true)
            """);
        statement.executeUpdate(
            """
            insert into work_types (
              id, user_id, name, normalized_name, calculation_method, compensation_method,
              unit_label, unit_symbol, rate_per_unit, currency, composite_enabled, active, display_order
            ) values (
              '00000000-0000-0000-0000-000000000402',
              '00000000-0000-0000-0000-000000000401',
              'Legacy category', 'legacy category', 'UNIT_BASED', 'PER_UNIT',
              'Square metre', 'm2', 50, 'EUR', true, true, 0
            )
            """);
        statement.executeUpdate(
            """
            insert into work_types (
              id, user_id, name, normalized_name, calculation_method, compensation_method,
              composite_enabled, active, display_order
            ) values
              (
                '00000000-0000-0000-0000-000000000403',
                '00000000-0000-0000-0000-000000000401',
                'Incomplete hourly units', 'incomplete hourly units',
                'UNITS_PER_HOUR_BASED', 'HOURLY', false, true, 1
              ),
              (
                '00000000-0000-0000-0000-000000000404',
                '00000000-0000-0000-0000-000000000401',
                'Incomplete paid units', 'incomplete paid units',
                'UNIT_BASED', 'PER_UNIT', false, true, 2
              )
            """);
      }

      Flyway latest =
          Flyway.configure()
              .dataSource(url, username, password)
              .schemas(schema)
              .defaultSchema(schema)
              .createSchemas(true)
              .cleanDisabled(false)
              .locations("classpath:db/migration")
              .load();
      latest.migrate();

      try (var connection = DriverManager.getConnection(url, username, password);
          var statement = connection.createStatement()) {
        statement.execute("set search_path to " + schema);
        try (var rs =
            statement.executeQuery(
                """
                select composite_enabled, unit_label, unit_symbol, units_per_hour, rate_per_unit, currency
                from work_types
                where id = '00000000-0000-0000-0000-000000000402'
                """)) {
          assertThat(rs.next()).isTrue();
          assertThat(rs.getBoolean("composite_enabled")).isTrue();
          assertThat(rs.getString("unit_label")).isNull();
          assertThat(rs.getString("unit_symbol")).isNull();
          assertThat(rs.getBigDecimal("units_per_hour")).isNull();
          assertThat(rs.getBigDecimal("rate_per_unit")).isNull();
          assertThat(rs.getString("currency")).isNull();
        }
        try (var rs =
            statement.executeQuery(
                """
                select count(*)
                from work_types
                where id in (
                  '00000000-0000-0000-0000-000000000403',
                  '00000000-0000-0000-0000-000000000404'
                )
                  and composite_enabled
                  and unit_label is null
                  and unit_symbol is null
                  and units_per_hour is null
                  and rate_per_unit is null
                  and currency is null
                """)) {
          assertThat(rs.next()).isTrue();
          assertThat(rs.getInt(1)).isEqualTo(2);
        }
      }
    } finally {
      Flyway.configure()
          .dataSource(url, username, password)
          .schemas(schema)
          .defaultSchema(schema)
          .cleanDisabled(false)
          .load()
          .clean();
    }
  }

  private void insertLegacyWorkEntry(String url, String username, String password, String schema)
      throws Exception {
    try (var connection = DriverManager.getConnection(url, username, password);
        var statement = connection.createStatement()) {
      statement.execute("set search_path to " + schema);
      statement.executeUpdate(
          """
          insert into user_accounts (id, email, password_hash, email_verified)
          values ('00000000-0000-0000-0000-000000000101', 'legacy-latest-migration@example.com', 'hash', true)
          """);
      statement.executeUpdate(
          """
          insert into user_preferences (id, user_id, language, timezone, currency, first_day_of_week, date_format, time_format, theme, default_break_minutes, preferred_daily_minutes, paid_sick_leave, paid_vacation)
          values ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000101', 'en', 'Europe/Berlin', 'EUR', 'MONDAY', 'DD.MM.YYYY', 'H24', 'SYSTEM', 30, 480, true, true)
          """);
      statement.executeUpdate(
          """
          insert into work_types (id, user_id, name, normalized_name, calculation_method, compensation_method, color, active, display_order)
          values ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000101', 'Legacy Shift', 'legacy shift', 'TIME_BASED', 'HOURLY', '#87C95A', true, 0)
          """);
      statement.executeUpdate(
          """
          insert into hourly_rate_periods (id, user_id, hourly_rate, currency, valid_from)
          values ('00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000101', 20.00, 'EUR', '2026-01-01')
          """);
      statement.executeUpdate(
          """
          insert into work_entries (
            id, user_id, work_type_id, work_date, work_type_name_snapshot, calculation_method_snapshot,
            hourly_rate_snapshot, currency_snapshot, calculated_minutes, gross_amount, extra_pay_percentage,
            compensation_method_snapshot
          )
          values (
            '00000000-0000-0000-0000-000000000301',
            '00000000-0000-0000-0000-000000000101',
            '00000000-0000-0000-0000-000000000201',
            '2026-07-16',
            'Legacy Shift',
            'TIME_BASED',
            20.00,
            'EUR',
            480.000000000000000,
            160.000000000000000,
            0,
            'HOURLY'
          )
          """);
      statement.executeUpdate(
          """
          insert into time_entry_details (id, work_entry_id, start_time, end_time, break_minutes, total_interval_minutes)
          values ('00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000301', '08:00', '16:00', 0, 480)
          """);
    }
  }

  private void insertV90StaffingFixture(
      String url, String username, String password, String schema) throws Exception {
    insertV90StaffingFixture(url, username, password, schema, false);
  }

  private void insertV90StaffingFixture(
      String url, String username, String password, String schema,
      boolean reverseRequirementOrder) throws Exception {
    try (var connection = DriverManager.getConnection(url, username, password);
        var statement = connection.createStatement()) {
      statement.execute("set search_path to " + schema);
      statement.executeUpdate(
          """
          insert into user_accounts (id, email, password_hash, email_verified)
          values ('00000000-0000-0000-0000-000000000901', 'v90-plan-owner@example.com', 'hash', true)
          """);
      statement.executeUpdate(
          """
          insert into organizations (id, name, organization_type, timezone) values
            ('00000000-0000-0000-0000-000000000911', 'V90 Business', 'BUSINESS', 'Europe/Berlin'),
            ('00000000-0000-0000-0000-000000000912', 'Other Business', 'BUSINESS', 'Europe/Berlin')
          """);
      statement.executeUpdate(
          """
          insert into organization_memberships (
            id, organization_id, user_id, membership_role, membership_status, joined_at
          ) values (
            '00000000-0000-0000-0000-000000000921',
            '00000000-0000-0000-0000-000000000911',
            '00000000-0000-0000-0000-000000000901',
            'OWNER', 'ACTIVE', current_timestamp
          )
          """);
      statement.executeUpdate(
          """
          insert into organization_units (
            id, organization_id, name, unit_type, check_in_mode, active, display_order
          ) values
            ('00000000-0000-0000-0000-000000000931', '00000000-0000-0000-0000-000000000911', 'Hotel Munich', 'LOCATION', 'OPTIONAL', true, 0),
            ('00000000-0000-0000-0000-000000000932', '00000000-0000-0000-0000-000000000911', 'Hotel Augsburg', 'LOCATION', 'OPTIONAL', true, 1),
            ('00000000-0000-0000-0000-000000000934', '00000000-0000-0000-0000-000000000912', 'Other Tenant Unit', 'LOCATION', 'OPTIONAL', true, 0)
          """);
      statement.executeUpdate(
          """
          insert into organization_work_types (
            id, organization_id, unit_id, code, name, color, default_start_time,
            default_end_time, default_break_minutes, active
          ) values
            ('00000000-0000-0000-0000-000000000941', '00000000-0000-0000-0000-000000000911', '00000000-0000-0000-0000-000000000931', 'ROOM', 'Room cleaning', '#10B981', '09:00', '16:30', 30, true),
            ('00000000-0000-0000-0000-000000000942', '00000000-0000-0000-0000-000000000911', '00000000-0000-0000-0000-000000000932', 'PF', 'Public early', '#10B981', '05:00', '13:30', 30, true)
          """);
      String firstRequirement =
          "('00000000-0000-0000-0000-000000000951', '00000000-0000-0000-0000-000000000911', "
              + "'00000000-0000-0000-0000-000000000931', '00000000-0000-0000-0000-000000000941', "
              + "'2026-08-10', '09:00', '16:30', 4, '50 rooms', 'PUBLISHED', current_timestamp, "
              + "'00000000-0000-0000-0000-000000000921')";
      String secondRequirement =
          "('00000000-0000-0000-0000-000000000952', '00000000-0000-0000-0000-000000000911', "
              + "'00000000-0000-0000-0000-000000000931', '00000000-0000-0000-0000-000000000941', "
              + "'2026-08-11', '09:00', '16:30', 2, '40 rooms', 'DRAFT', null, "
              + "'00000000-0000-0000-0000-000000000921')";
      String thirdRequirement =
          "('00000000-0000-0000-0000-000000000953', '00000000-0000-0000-0000-000000000911', "
              + "'00000000-0000-0000-0000-000000000932', '00000000-0000-0000-0000-000000000942', "
              + "'2026-08-10', '05:00', '13:30', 1, null, 'DRAFT', null, "
              + "'00000000-0000-0000-0000-000000000921')";
      var requirementRows = reverseRequirementOrder
          ? java.util.List.of(thirdRequirement, secondRequirement, firstRequirement)
          : java.util.List.of(firstRequirement, secondRequirement, thirdRequirement);
      statement.executeUpdate(
          """
          insert into staffing_requirements (
            id, organization_id, unit_id, work_type_id, work_date, start_time, end_time,
            required_workers, notes, publication_status, published_at, created_by_membership_id
          ) values
          """ + String.join(",\n", requirementRows));
      statement.executeUpdate(
          """
          insert into staffing_assignments (
            id, requirement_id, membership_id, assignment_status, assigned_by_membership_id
          ) values
            ('00000000-0000-0000-0000-000000000961', '00000000-0000-0000-0000-000000000951', '00000000-0000-0000-0000-000000000921', 'ASSIGNED', '00000000-0000-0000-0000-000000000921'),
            ('00000000-0000-0000-0000-000000000962', '00000000-0000-0000-0000-000000000953', '00000000-0000-0000-0000-000000000921', 'ASSIGNED', '00000000-0000-0000-0000-000000000921')
          """);
      statement.executeUpdate(
          """
          insert into staffing_member_day_entries (
            id, organization_id, membership_id, work_date, entry_type,
            notes, created_by_membership_id
          ) values (
            '00000000-0000-0000-0000-000000000971',
            '00000000-0000-0000-0000-000000000911',
            '00000000-0000-0000-0000-000000000921',
            '2026-08-12', 'REST_DAY', 'Preserve this entry',
            '00000000-0000-0000-0000-000000000921'
          )
          """);
    }
  }

  private Flyway flyway(
      String url, String username, String password, String schema, String target) {
    var configuration = Flyway.configure()
        .dataSource(url, username, password)
        .schemas(schema)
        .defaultSchema(schema)
        .createSchemas(true)
        .cleanDisabled(false)
        .locations("classpath:db/migration");
    if (target != null) configuration.target(target);
    return configuration.load();
  }

  private Flyway flywayAtTimezone(
      String url, String username, String password, String schema, String target,
      String timezone) {
    var configuration = Flyway.configure()
        .dataSource(url, username, password)
        .schemas(schema)
        .defaultSchema(schema)
        .createSchemas(true)
        .cleanDisabled(false)
        .initSql("SET TIME ZONE '" + timezone.replace("'", "''") + "'")
        .locations("classpath:db/migration");
    if (target != null) configuration.target(target);
    return configuration.load();
  }

  private void clean(String url, String username, String password, String schema) {
    Flyway.configure()
        .dataSource(url, username, password)
        .schemas(schema)
        .defaultSchema(schema)
        .cleanDisabled(false)
        .load()
        .clean();
  }

  private void assertCount(java.sql.Statement statement, String table, int expected)
      throws Exception {
    assertQueryCount(statement, "select count(*) from " + table, expected);
  }

  private void assertQueryCount(java.sql.Statement statement, String sql, int expected)
      throws Exception {
    try (var result = statement.executeQuery(sql)) {
      assertThat(result.next()).isTrue();
      assertThat(result.getInt(1)).isEqualTo(expected);
    }
  }

  private String queryString(
      String url, String username, String password, String schema, String sql) throws Exception {
    try (var connection = DriverManager.getConnection(url, username, password);
        var statement = connection.createStatement()) {
      statement.execute("set search_path to " + schema);
      try (var result = statement.executeQuery(sql)) {
        assertThat(result.next()).isTrue();
        return result.getString(1);
      }
    }
  }

  private String latestMigrationVersion() {
    try (var paths = Files.walk(Path.of("src/main/resources/db/migration"))) {
      return paths
          .map(path -> path.getFileName().toString())
          .filter(name -> name.matches("V\\d+__.*\\.sql"))
          .map(name -> name.substring(1, name.indexOf("__")))
          .max(Comparator.comparingInt(Integer::parseInt))
          .orElseThrow();
    } catch (Exception e) {
      throw new IllegalStateException("Could not determine latest migration version", e);
    }
  }
}
