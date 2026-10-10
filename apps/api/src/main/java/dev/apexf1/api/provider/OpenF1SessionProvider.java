package dev.apexf1.api.provider;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.apexf1.api.persistence.entity.SessionEntity;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class OpenF1SessionProvider implements SessionProvider {

    private final HttpClient httpClient;
    private final ObjectMapper objectMapper;
    private final String baseUrl;

    public OpenF1SessionProvider(
            ObjectMapper objectMapper,
            @Value("${apex.openf1.base-url}") String baseUrl) {
        this.httpClient = HttpClient.newHttpClient();
        this.objectMapper = objectMapper;
        this.baseUrl = baseUrl;
    }

    @Override
    public List<SessionEntity> fetchSessions(int year) {
        String url = baseUrl + "/sessions?year=" + year;

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .header("Accept", "application/json")
                .GET()
                .build();

        try {
            HttpResponse<String> response =
                    httpClient.send(request, HttpResponse.BodyHandlers.ofString());

            if (response.statusCode() != 200) {
                throw new IllegalStateException(
                        "OpenF1 returned HTTP " + response.statusCode()
                                + ": " + response.body());
            }

            JsonNode root = objectMapper.readTree(response.body());
            List<SessionEntity> sessions = new ArrayList<>();

            for (JsonNode node : root) {
                sessions.add(new SessionEntity(
                        node.get("session_key").asInt(),
                        node.get("circuit_short_name").asText(),
                        node.get("session_name").asText(),
                        node.get("session_type").asText(),
                        node.get("year").asInt(),
                        Instant.parse(node.get("date_start").asText()),
                        Instant.parse(node.get("date_end").asText())
                ));
            }

            return sessions;

        } catch (IOException e) {
            throw new IllegalStateException(
                    "Failed to fetch OpenF1 session data", e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(
                    "Interrupted while fetching OpenF1 session data", e);
        }
    }
}
