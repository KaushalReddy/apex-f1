FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY apps/api/pom.xml ./
RUN mvn -q -B dependency:go-offline
COPY apps/api/src ./src
RUN mvn -q -B package -DskipTests

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /src/target/apex-api.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
