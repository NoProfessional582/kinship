# Reject stack errors; allow only complete, known refusal messages after API tests.
# awk -v service=web -v refusals=1 -f scripts/check-stack-logs.awk < logs
BEGIN {
  prefix = "An operation failed because it depends on one or more records that were required but not found. "
  # columns unknown id; tasks unknown column
  query["boardColumn.findFirstOrThrow"] = 1
  # contacts unknown id; trash restore unknown contact
  query["contact.findFirstOrThrow"] = 1
  # edges unknown id
  query["entityEdge.findFirstOrThrow"] = 1
  # calendar unknown entry; entries PATCH; trash restore
  query["entry.findFirstOrThrow"] = 1
  # entries DELETE unknown note
  query["entry.findUniqueOrThrow"] = 1
  # projects unknown id; tasks unknown project; trash restore
  query["project.findFirstOrThrow"] = 1
  # tasks unknown id/parent; trash restore
  query["task.findFirstOrThrow"] = 1
  for (op in query)
    allowed["prisma:error Invalid `prisma." op "()` invocation: " prefix "No record was found for a query."] = 1
  # entries.integration: integer overflow rollback.
  database["ERROR:  value \"2147483648\" is out of range for type integer"] = 1
  # archive-import.integration: duplicate-slug rollback, twice.
  database["ERROR:  duplicate key value violates unique constraint \"Contact_owner_slug_key\""] = 1
}
{
  line = $0
  sub(/[[:space:]]+$/, "", line)
  if (service == "db")
    sub(/^[0-9-]+ [0-9:.]+ UTC \[[0-9]+\] /, "", line)
  if (service == "web" && line == "prisma:error") {
    # Consume only the exact known five-line shape. A malformed block always fails.
    if ((getline operation) <= 0 || (getline blank1) <= 0 ||
        (getline blank2) <= 0 || (getline detail) <= 0 ||
        operation !~ /^Invalid `prisma\./ || blank1 != "" || blank2 != "") {
      print "Malformed Prisma error block: " line > "/dev/stderr"
      failed = 1
      next
    }
    line = line " " operation " " detail
  }
  if (tolower(line) ~ /error|exception|fatal|unhandled/) {
    if (refusals && ((service == "web" && (line in allowed)) ||
                     (service == "db" && (line in database)))) next
    print line > "/dev/stderr"
    failed = 1
  }
}
END { exit failed ? 1 : 0 }
