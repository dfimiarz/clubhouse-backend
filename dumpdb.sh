#!/bin/bash
set -euo pipefail

# Source database name
database_name="clubhouse"

echo "Running mysqldump for \"$database_name\""

# Get the current date and time
current_date=$(date +"%Y-%m-%d_%H-%M-%S")

# Set the directory where the file should be written
output_dir="../dumps"

# Check if the directory exists, if not exit with an error
if [ ! -d "$output_dir" ]; then
    echo "Error: Directory $output_dir does not exist."
    exit 1
fi

# Set the output file name
output_file="${output_dir}/mysql_dump_${database_name}_${current_date}.sql"

container="${MYSQL_CONTAINER:-}"
if [ -z "$container" ]; then
    echo "Running containers:"
    docker ps --format '  {{.Names}}\t{{.Image}}'
    echo
    read -r -p "MySQL container name: " container
fi

if [ -z "$container" ]; then
    echo "Error: container name is required."
    exit 1
fi

# --databases makes a self-contained dump (CREATE DATABASE + USE)
docker exec -i "$container" sh -c 'exec mysqldump --databases '"$database_name"' -uroot -p"$MYSQL_ROOT_PASSWORD" -R -E' > "$output_file"

echo "Dump complete to \"$output_file\""
