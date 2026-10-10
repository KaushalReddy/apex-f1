package dev.apexf1.api.provider;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.apexf1.api.dto.PositionSample;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class OpenF1LocationProvider implements LocationProvider {

    private final HttpClient httpClient;
    private final ObjectMapper objectMapper;
    private final String baseUrl;

    public OpenF1LocationProvider(
            ObjectMapper objectMapper,
            @Value("${apex.openf1.base-url}") String baseUrl) {
        this.httpClient = HttpClient.newHttpClient();
        this.objectMapper = objectMapper;
        this.baseUrl = baseUrl;
    }

    @Override
    public List<PositionSample> fetchWindow(
            int sessionKey,
            int driverNumber,
            long fromMs,
            long toMs) {

        String dateGt = Instant.ofEpochMilli(fromMs).toString();
        String dateLt = Instant.ofEpochMilli(toMs).toString();

        String url = baseUrl
                + "/location"
                + "?session_key=" + sessionKey
                + "&driver_number=" + driverNumber
                + "&date%3E" + dateGt
                + "&date%3C" + dateLt;

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
            List<PositionSample> samples = new ArrayList<>();

            for (JsonNode node : root) {
                samples.add(new PositionSample(
                        driverNumber,
                        Instant.parse(node.get("date").asText()).toEpochMilli(),
                        node.get("x").asDouble(),
                        node.get("y").asDouble(),
                        node.get("z").asDouble()
                ));
            }

            samples.sort(Comparator.comparingLong(PositionSample::sampleTimeMs));
            return samples;

        } catch (IOException | InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Failed to fetch OpenF1 location data", e);
        }
    }
}
